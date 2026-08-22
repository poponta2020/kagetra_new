import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { calculateCostUsd } from '../../classify/cost.js'
import { ParsedResultPayloadSchema } from '../schema.js'
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildRoutingSystemPrompt,
  buildRoutingUserPrompt,
} from './prompt.js'
import { RoutingResultSchema } from './routing-schema.js'
import {
  AiNoToolUseError,
  AiValidationError,
  type ExtractionCallResult,
  type ExtractionInput,
  type ResultImportAi,
  type RoutingCallResult,
  type RoutingInput,
} from './types.js'

/**
 * 本番用の Anthropic 実装。`classify/llm/anthropic.ts` を手本にした
 * provider-neutral 実装 — このファイル以外は `Anthropic.*` 型を知らない。
 *
 * classify とは独立にモデルを bump できるよう、このモジュール専用の定数を
 * 持つ(classify の `ANTHROPIC_MODEL_ID` を import しない)。
 */
export const ANTHROPIC_MODEL_ID = 'claude-sonnet-5'

const ROUTING_TOOL_NAME = 'record_routing'
const EXTRACTION_TOOL_NAME = 'record_extraction'

const ROUTING_MAX_TOKENS = 4096
// フル抽出の出力は実測で中央値33k・p90 74k トークン(実際の大会結果ファイルの
// 分布)。100k を上限にして余裕を持たせる。
const EXTRACTION_MAX_TOKENS = 100_000

export interface AnthropicResultImportAiOpts {
  apiKey: string
}

export class AnthropicResultImportAi implements ResultImportAi {
  private readonly client: Anthropic
  readonly modelId: string = ANTHROPIC_MODEL_ID

  constructor(opts: AnthropicResultImportAiOpts) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 })
  }

  async route(input: RoutingInput): Promise<RoutingCallResult> {
    const inputSchemaJson = toInputSchemaJson(RoutingResultSchema)

    const response = await this.client.messages.create({
      model: ANTHROPIC_MODEL_ID,
      max_tokens: ROUTING_MAX_TOKENS,
      // ルーティングは構造化判定のみで thinking を必要としない。省略すると
      // Sonnet 5 は adaptive thinking を ON にし、max_tokens が thinking と
      // 出力の合算上限になってしまう(classify/llm/anthropic.ts と同じ罠)。
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: buildRoutingSystemPrompt() }],
      tools: [
        {
          name: ROUTING_TOOL_NAME,
          description:
            'Record the routing verdict, class-name normalization map, and metadata for a tournament result file.',
          input_schema:
            inputSchemaJson as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: ROUTING_TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildRoutingUserPrompt(input),
        },
      ],
    })

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === ROUTING_TOOL_NAME,
    )
    if (!toolUse) {
      throw new AiNoToolUseError(
        `Anthropic response missing tool_use block for ${ROUTING_TOOL_NAME}`,
        JSON.stringify(response.content),
      )
    }

    const safeParse = RoutingResultSchema.safeParse(toolUse.input)
    if (!safeParse.success) {
      throw new AiValidationError(
        `Anthropic tool_use input failed schema validation: ${safeParse.error.message}`,
        JSON.stringify(toolUse.input),
      )
    }

    return {
      parsed: safeParse.data,
      raw: JSON.stringify(toolUse.input),
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      costUsd: calculateCostUsd({
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens:
          response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      }),
      model: ANTHROPIC_MODEL_ID,
      promptVersion: input.promptVersion,
    }
  }

  async extract(input: ExtractionInput): Promise<ExtractionCallResult> {
    const inputSchemaJson = toInputSchemaJson(ParsedResultPayloadSchema)

    const stream = this.client.messages.stream({
      model: ANTHROPIC_MODEL_ID,
      max_tokens: EXTRACTION_MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: buildExtractionSystemPrompt() }],
      tools: [
        {
          name: EXTRACTION_TOOL_NAME,
          description:
            'Record the fully transcribed tournament result payload.',
          input_schema:
            inputSchemaJson as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildUserMessageContent(input),
        },
      ],
    })

    // ストリームイベントから usage を積み上げると欠損する(0 になる)。
    // 必ず `finalMessage()` の戻り値から content / usage を取ること。
    const message = await stream.finalMessage()

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === EXTRACTION_TOOL_NAME,
    )
    if (!toolUse) {
      throw new AiNoToolUseError(
        `Anthropic response missing tool_use block for ${EXTRACTION_TOOL_NAME}`,
        JSON.stringify(message.content),
      )
    }

    const safeParse = ParsedResultPayloadSchema.safeParse(toolUse.input)
    if (!safeParse.success) {
      throw new AiValidationError(
        `Anthropic tool_use input failed schema validation: ${safeParse.error.message}`,
        JSON.stringify(toolUse.input),
      )
    }

    return {
      // AI が何を書いても由来(このモジュールのプロンプトバージョン)が
      // 正しく残るよう、parserVersion は呼び出し側で上書きする。
      parsed: {
        ...safeParse.data,
        parserVersion: `ai-extract-${input.promptVersion}`,
      },
      raw: JSON.stringify(toolUse.input),
      tokensInput: message.usage.input_tokens,
      tokensOutput: message.usage.output_tokens,
      costUsd: calculateCostUsd({
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens:
          message.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      }),
      model: ANTHROPIC_MODEL_ID,
      promptVersion: input.promptVersion,
    }
  }
}

/**
 * Zod v4 のスキーマを Anthropic tool の `input_schema` 用 JSON Schema へ
 * 変換する共通ヘルパー。`target: 'draft-7'` は `Tool.InputSchema` と揃え、
 * `io: 'input'` は入力側スキーマを要求する(`.transform()` 等が紛れ込んでも
 * 壊れないようにする保険)。`$schema` キーワードは Anthropic には不要なので
 * 削除する(`classify/llm/anthropic.ts` と同じ処理)。
 */
function toInputSchemaJson(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>
  delete json.$schema
  return json
}

/**
 * フル抽出のユーザーメッセージ content 配列を組み立てる。PDF のときは
 * document block をテキストより前に置く(Anthropic 推奨の順序)。
 */
function buildUserMessageContent(
  input: ExtractionInput,
): Array<Anthropic.DocumentBlockParam | Anthropic.TextBlockParam> {
  const blocks: Array<
    Anthropic.DocumentBlockParam | Anthropic.TextBlockParam
  > = []

  if (input.source.kind === 'pdf') {
    blocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: input.source.base64,
      },
      title: input.filename,
    })
  }

  blocks.push({
    type: 'text',
    text: buildExtractionUserPrompt(input),
  })

  return blocks
}
