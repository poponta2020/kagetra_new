import type { ParsedResultPayload } from '../schema.js'
import type { RoutingResult } from './routing-schema.js'

/**
 * Provider-neutral AI abstraction for result-import。`classify/llm/types.ts`
 * と同じ思想 — この module から `Anthropic.*` 型は一切漏らさない。テストは
 * `FixtureResultImportAi` を注入し、本番は `AnthropicResultImportAi` を使う。
 */

export interface RoutingInput {
  filename: string
  subject: string
  sheetNames: string[]
  sheetHeadRows: Array<{ sheetName: string; rows: string[][] }>
  parserAttempt: Array<{ className: string; participantCount: number }>
  promptVersion: string
}

export interface RoutingCallResult {
  parsed: RoutingResult
  raw: string
  tokensInput: number
  tokensOutput: number
  costUsd: number
  model: string
  promptVersion: string
}

export type ExtractionSource =
  | { kind: 'sheets'; sheets: Array<{ name: string; csv: string }> }
  | { kind: 'pdf'; base64: string }

export interface ExtractionInput {
  filename: string
  subject: string
  promptVersion: string
  source: ExtractionSource
}

export interface ExtractionCallResult {
  parsed: ParsedResultPayload
  raw: string
  tokensInput: number
  tokensOutput: number
  costUsd: number
  model: string
  promptVersion: string
}

export interface ResultImportAi {
  readonly modelId: string
  route(input: RoutingInput): Promise<RoutingCallResult>
  extract(input: ExtractionInput): Promise<ExtractionCallResult>
}

/**
 * Provider-neutral error class for AI call failures。`rawResponse` は run
 * 側が `parse_failed` 等の失敗理由と一緒に記録できるよう、モデルが実際に
 * 返した内容(JSON 文字列)を保持する。`classify/llm/types.ts` の
 * `LLMExtractorError` と同じ役割。
 */
export class ResultImportAiError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string | null,
  ) {
    super(message)
    this.name = 'ResultImportAiError'
  }
}

/**
 * tool_use ブロックが応答に含まれなかったときに throw する。
 * `content` は Anthropic の `ContentBlock[]` を型として持ち込まないよう、
 * 呼び出し側で JSON 文字列化してから `rawResponse` へ渡す。
 */
export class AiNoToolUseError extends ResultImportAiError {
  constructor(message: string, content: string) {
    super(message, content)
    this.name = 'AiNoToolUseError'
  }
}

/**
 * tool_use の input が Zod 検証に失敗したときに throw する
 * (routing は `RoutingResultSchema`、extraction は `ParsedResultPayloadSchema`)。
 */
export class AiValidationError extends ResultImportAiError {
  constructor(message: string, toolInput: string) {
    super(message, toolInput)
    this.name = 'AiValidationError'
  }
}
