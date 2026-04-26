import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ExtractionPayloadSchema } from '../schema.js'
import {
  LLMExtractorError,
  type LLMExtractionInput,
  type LLMExtractionResult,
  type LLMExtractor,
} from './types.js'
import { calculateCostUsd } from '../cost.js'
import { buildUserPrompt } from '../prompt.js'

/**
 * Real Anthropic implementation of `LLMExtractor`. Production wiring (Phase 5)
 * picks this up; tests inject `FixtureLLMExtractor` / `BrokenLLMExtractor`
 * instead. The provider-neutral `LLMExtractor` interface is what the rest of
 * the pipeline talks to — nothing outside this file imports `Anthropic.*`.
 *
 * Design choices worth knowing about before editing:
 *
 *   - **Forced tool use.** `tool_choice: { type: 'tool', name: TOOL_NAME }`
 *     guarantees Claude calls our `record_extraction` tool. Without this the
 *     model occasionally returns a text explanation instead, which we'd have
 *     to treat as a failure — forcing the tool sidesteps that failure mode.
 *
 *   - **Prompt cache on the system block.** `cache_control: { type:
 *     'ephemeral', ttl: '1h' }` is attached to the system text. The system
 *     prompt is the only stable, large block — the user content varies per
 *     mail, so caching it would never hit. The 1h TTL spans our 30-min cron
 *     interval comfortably; 5m would expire mid-cycle in slow weeks.
 *
 *   - **PDFs as native `document` blocks, placed BEFORE the text block.**
 *     Anthropic explicitly recommends documents before instructions. The
 *     base64 source comes from the pipeline (we do not re-fetch the PDF
 *     here — `LLMExtractionInput.attachments` carries it).
 *
 *   - **`maxRetries: 3`** instead of the SDK default 2. Yahoo IMAP runs are
 *     single-threaded and a 429 stall usually clears within the SDK's
 *     exponential backoff; one extra retry is cheap insurance for cron runs.
 *
 *   - **Tool input is already a parsed object.** The SDK types `input` as
 *     `unknown` (it could be any JSON), but it has already been JSON-parsed.
 *     Calling `JSON.parse(toolUse.input)` is a stringification + parse round
 *     trip and breaks at runtime — see Phase 0 facts.
 */
const TOOL_NAME = 'record_extraction'
/**
 * Public so the classifier (and tests) can refer to the model by import
 * rather than by literal string. Previously the classifier's failed branch
 * had a duplicate `'claude-sonnet-4-6'` literal that drifted out of sync
 * with this constant whenever we bumped the model (review r3 Should fix).
 */
export const ANTHROPIC_SONNET_46_MODEL_ID = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 4096

/**
 * Thrown when Anthropic's response has no `tool_use` block matching our tool
 * name. The classifier (Phase 4) catches this and persists an `ai_failed`
 * draft with the raw response so a reviewer can see what the model said
 * instead of calling the tool.
 *
 * Inherits `LLMExtractorError.rawResponse` so the classifier can pull the
 * JSON-serialised content blocks out without knowing about Anthropic types
 * (review r3 Should fix: failed-branch `aiRawResponse` used to receive only
 * the generic error message).
 */
export class LLMNoToolUseError extends LLMExtractorError {
  constructor(
    message: string,
    public readonly content: Anthropic.ContentBlock[],
  ) {
    super(message, JSON.stringify(content))
    this.name = 'LLMNoToolUseError'
  }
}

/**
 * Thrown when Anthropic returns a `tool_use` block but its `input` payload
 * fails Zod validation against `ExtractionPayloadSchema`. The classifier
 * persists `rawResponse` (the unparsed tool input) on the resulting
 * `ai_failed` draft so a reviewer can see exactly what shape the model
 * returned.
 */
export class LLMValidationError extends LLMExtractorError {
  constructor(
    message: string,
    public readonly toolInput: unknown,
    public readonly zodError: z.ZodError,
  ) {
    super(message, JSON.stringify(toolInput))
    this.name = 'LLMValidationError'
  }
}

export interface AnthropicSonnet46Opts {
  apiKey: string
  /**
   * Override `max_tokens` on the request. Defaults to 4096 — the
   * `record_extraction` tool output for a typical announcement is well under
   * 1k tokens, but a few-shot-rich prompt occasionally pushes Claude into
   * generating a longer `extras.timetable_summary`. 4096 leaves headroom
   * without inviting the model to ramble.
   */
  maxTokens?: number
}

export class AnthropicSonnet46Extractor implements LLMExtractor {
  private readonly client: Anthropic
  private readonly maxTokens: number
  readonly modelId: string = ANTHROPIC_SONNET_46_MODEL_ID

  constructor(opts: AnthropicSonnet46Opts) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 })
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  }

  async extract(input: LLMExtractionInput): Promise<LLMExtractionResult> {
    // Zod v4 ships its own JSON Schema converter; the older
    // `zod-to-json-schema` package walks v3's `_def` shape and silently
    // returns a near-empty `{ "$schema": "..." }` for v4 schemas. That made
    // the Anthropic call go out with no input_schema constraints at all
    // (Phase 0 review: PR3 r1 Blocker). `target: 'draft-7'` keeps the
    // payload aligned with `Tool.InputSchema`, and `io: 'input'` requests
    // the input-side schema (matters once `.transform()` / coerced types
    // creep in — currently a no-op but cheap insurance against drift).
    const inputSchemaJson = z.toJSONSchema(ExtractionPayloadSchema, {
      target: 'draft-7',
      io: 'input',
    }) as Record<string, unknown>
    // `$schema` keyword is metadata — Anthropic ignores it but warns if
    // present, so strip it preemptively.
    delete inputSchemaJson.$schema

    const response = await this.client.messages.create({
      model: ANTHROPIC_SONNET_46_MODEL_ID,
      max_tokens: this.maxTokens,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          // 1h ephemeral cache. No beta header required — cache_control is
          // GA on the 2023-06-01 API surface used by the SDK. The system
          // prompt is the largest stable block in the request, so caching
          // it cuts ~10× off subsequent calls within the TTL.
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record extracted tournament announcement fields.',
          // The SDK types `input_schema` as a narrow shape (`{ type:
          // 'object'; properties?; required?; [k]: unknown }`), but
          // `z.toJSONSchema` returns a wider JSON Schema that includes
          // every keyword in the spec. The cast is safe — Anthropic
          // accepts arbitrary JSON Schema 7 here.
          input_schema:
            inputSchemaJson as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      // Force the specific tool — without this Claude can return a text
      // block explaining itself instead of invoking the tool.
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildUserMessageContent(input),
        },
      ],
    })

    // Multiple content blocks may arrive (e.g. a leading text block + the
    // tool_use). We only need the tool_use block matching our tool name.
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === TOOL_NAME,
    )
    if (!toolUse) {
      throw new LLMNoToolUseError(
        `Anthropic response missing tool_use block for ${TOOL_NAME}`,
        response.content,
      )
    }
    // `toolUse.input` is already a parsed object — the SDK does not deliver
    // it as a JSON string. Hand it straight to Zod for validation. We wrap
    // the Zod failure as `LLMValidationError` so the classifier (and the
    // human eventually reviewing the `ai_failed` draft) can see the actual
    // tool input the model returned, not just the Zod error message.
    const safeParse = ExtractionPayloadSchema.safeParse(toolUse.input)
    if (!safeParse.success) {
      throw new LLMValidationError(
        `Anthropic tool_use input failed schema validation: ${safeParse.error.message}`,
        toolUse.input,
        safeParse.error,
      )
    }

    return {
      parsed: safeParse.data,
      raw: JSON.stringify(toolUse.input),
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      costUsd: calculateCostUsd({
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens:
          response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      }),
      model: ANTHROPIC_SONNET_46_MODEL_ID,
      promptVersion: input.promptVersion,
    }
  }
}

/**
 * Build the user-message `content` array. PDFs come first as native document
 * blocks (Anthropic recommends documents before instructions); the textual
 * per-mail prompt is appended last as a single text block.
 *
 * The text block deliberately has no `cache_control` — every mail's subject
 * / body is unique, so caching it would never produce a hit and would burn a
 * cache breakpoint (we get 4 total per request).
 */
function buildUserMessageContent(
  input: LLMExtractionInput,
): Array<Anthropic.DocumentBlockParam | Anthropic.TextBlockParam> {
  const blocks: Array<
    Anthropic.DocumentBlockParam | Anthropic.TextBlockParam
  > = []

  for (const att of input.attachments) {
    if (att.kind !== 'pdf') continue
    blocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: att.base64,
      },
      title: att.filename,
    })
  }

  blocks.push({
    type: 'text',
    text: buildUserPrompt(input),
  })

  return blocks
}
