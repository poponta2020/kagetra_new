import type { ExtractionPayload } from '../schema.js'

/**
 * Provider-neutral extractor abstraction. Mirrors the `MailSource` interface
 * shape in `apps/mail-worker/src/fetch/fetcher.ts:18-21` — pluggable enough
 * that tests inject `FixtureLLMExtractor` / `BrokenLLMExtractor` while
 * production wires `AnthropicSonnet46Extractor` (added in Phase 3).
 *
 * Anthropic-specific concepts intentionally do NOT leak into this module: no
 * `Anthropic.*` types, no `tool_use` block references. Token-side fields
 * (`cacheReadTokens`, `cacheWriteTokens`) are kept as plain numbers — they
 * are the union of fields the cost calculator needs across providers, and
 * any provider that doesn't support cache simply reports 0.
 */
export interface LLMExtractionInput {
  systemPrompt: string
  promptVersion: string
  emailMeta: { subject: string; from: string; date: Date }
  emailBodyText: string
  /**
   * Attachments to forward to the LLM. PDFs are passed as base64 (Anthropic
   * native document blocks consume base64 directly); DOCX / text-extracted
   * material is passed as plain text already extracted by PR2's pipeline.
   * XLSX is intentionally not forwarded — the extractor was disabled in PR2
   * for security reasons.
   */
  attachments: Array<
    | { kind: 'pdf'; filename: string; base64: string }
    | { kind: 'text'; filename: string; text: string }
  >
}

export interface LLMExtractionResult {
  parsed: ExtractionPayload
  raw: string
  tokensInput: number
  tokensOutput: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  model: string
  promptVersion: string
}

export interface LLMExtractor {
  extract(input: LLMExtractionInput): Promise<LLMExtractionResult>
}
