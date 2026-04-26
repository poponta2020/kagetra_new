import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ExtractionPayloadSchema, type ExtractionPayload } from '../schema.js'
import type {
  LLMExtractionInput,
  LLMExtractionResult,
  LLMExtractor,
} from './types.js'

/**
 * Deterministic LLM extractor used by unit tests and `--mock-llm` smoke runs.
 * Looks the email subject up in a `Map<subject, payload>` and returns the
 * stored payload; falls back to a noise response when nothing matches so the
 * pipeline can still exercise its "AI says noise" branch end-to-end without
 * any network calls.
 *
 * The synthetic token / cost numbers are non-zero so log lines stay readable
 * (a 0/0/0 line is visually indistinguishable from "the API was never
 * called"), but they are plainly labeled `model: 'fixture'` so nothing
 * downstream confuses them with real billing data.
 */
const FIXTURE_MODEL = 'fixture'
const FIXTURE_PROMPT_VERSION = 'fixture-1.0'

const FIXTURE_NOISE_PAYLOAD: ExtractionPayload = {
  is_tournament_announcement: false,
  confidence: 0.95,
  reason: 'fixture default',
  is_correction: false,
  references_subject: null,
  extracted: {
    title: null,
    formal_name: null,
    event_date: null,
    venue: null,
    fee_jpy: null,
    payment_deadline: null,
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    eligible_grades: null,
    kind: null,
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
  },
}

export class FixtureLLMExtractor implements LLMExtractor {
  constructor(private readonly fixtures: Map<string, ExtractionPayload>) {}

  async extract(input: LLMExtractionInput): Promise<LLMExtractionResult> {
    const subject = input.emailMeta.subject
    const matched = this.fixtures.get(subject)
    const parsed = matched ?? FIXTURE_NOISE_PAYLOAD
    return {
      parsed,
      raw: JSON.stringify(parsed),
      tokensInput: 100,
      tokensOutput: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      model: FIXTURE_MODEL,
      promptVersion: FIXTURE_PROMPT_VERSION,
    }
  }
}

/**
 * Read a directory of `<subject>.expected.json` files and key each parsed
 * payload by the basename (without extension). Used by `--mock-llm` to seed
 * `FixtureLLMExtractor` from on-disk fixtures without rebuilding the worker.
 *
 * Each file is validated against `ExtractionPayloadSchema` so a typo in a
 * fixture surfaces at load time rather than producing a confusing classifier
 * Zod failure later. Files that don't end in `.expected.json` are ignored so
 * the same directory can also hold human-readable READMEs.
 */
export async function loadFixturesFromDir(
  dir: string,
): Promise<Map<string, ExtractionPayload>> {
  const fixtures = new Map<string, ExtractionPayload>()
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.expected.json')) continue
    const subject = entry.name.slice(0, -'.expected.json'.length)
    const raw = await readFile(join(dir, entry.name), 'utf8')
    const payload = ExtractionPayloadSchema.parse(JSON.parse(raw))
    fixtures.set(subject, payload)
  }
  return fixtures
}
