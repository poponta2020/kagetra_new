/**
 * Token usage → USD cost calculator for Anthropic Sonnet 4.6.
 *
 * Prices come straight from the Anthropic public pricing page. The numbers
 * are denominated per 1M tokens and we apply them to the four token streams
 * Anthropic reports on every `messages.create` response:
 *
 *   - `input_tokens`               — fresh prompt input billed at the input rate
 *   - `output_tokens`              — model output billed at the output rate
 *   - `cache_read_input_tokens`    — prompt input served from a cached prefix
 *   - `cache_creation_input_tokens`— prompt input written into the 1h cache
 *
 * We deliberately model only the 1h-TTL cache write price. The pipeline always
 * passes `cache_control: { type: 'ephemeral', ttl: '1h' }` (Phase 3); we never
 * write to the 5-minute tier, so mixing in the 5m price would be misleading
 * if it ever showed up in `cache_creation_input_tokens` — it cannot.
 *
 * USD is the canonical storage unit (`tournament_drafts.ai_cost_usd`).
 * Exchange-rate conversion to JPY is a presentation concern handled by the
 * web app, not this module.
 */

// Sonnet 4.6 pricing as of 2026-04, USD per 1M tokens.
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0
const PRICE_CACHE_READ_PER_M = 0.3
const PRICE_CACHE_WRITE_1H_PER_M = 6.0

const TOKENS_PER_M = 1_000_000

/**
 * Shape of `response.usage` returned by the Anthropic SDK on a successful
 * `messages.create` call. The two cache fields are present whenever
 * `cache_control` is in the request, and absent (here, optional) otherwise.
 */
export interface AnthropicUsageShape {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function calculateCostUsd(usage: AnthropicUsageShape): number {
  const fresh = (usage.input_tokens / TOKENS_PER_M) * PRICE_INPUT_PER_M
  const cachedRead =
    ((usage.cache_read_input_tokens ?? 0) / TOKENS_PER_M) * PRICE_CACHE_READ_PER_M
  const cacheWrite =
    ((usage.cache_creation_input_tokens ?? 0) / TOKENS_PER_M) *
    PRICE_CACHE_WRITE_1H_PER_M
  const out = (usage.output_tokens / TOKENS_PER_M) * PRICE_OUTPUT_PER_M
  return fresh + cachedRead + cacheWrite + out
}
