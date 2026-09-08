import type { ExtractionPayload } from './schema.js'

/**
 * Mechanical verification of `regional_eligibility[].evidence_quote`
 * (mail-ai-extract-refinements §3.2.12(c) / AC-68 / AC-69).
 *
 * The AI is asked to copy the sentence it based a D・E 級地域制限 verdict on
 * **verbatim** out of the material it was given. This module is the worker's
 * independent check that the quote actually appears in that material —
 * catching paraphrase, ellipsis (「…」), or a hallucinated quote before a
 * human reviewer ever sees the draft. It deliberately does NOT re-judge the
 * verdict itself; a failed match only flips `evidence_verified` to `false` so
 * the approval form can warn the reviewer, same as an "AI が根拠を示せなかった"
 * case.
 */

/**
 * Normalise text for substring comparison: Unicode NFKC (full-width ⇔
 * half-width, etc.) plus removal of whitespace-class characters (including
 * the full-width space U+3000, zero-width space, and BOM). This is the ONLY
 * normalisation requirements §3.2.12(c) asks for — no punctuation-insensitive
 * or fuzzy/edit-distance matching. Whitespace is stripped (not just
 * collapsed) because PDF text extraction sometimes splits digits with a
 * spurious space ("202 6 年"), and the quote and the source text won't
 * necessarily be split at the same place.
 */
export function normalizeEvidenceText(s: string): string {
  return s.normalize('NFKC').replace(/[\s\u200b\ufeff]+/gu, '')
}

/**
 * Build the single normalised string an `evidence_quote` is checked against.
 * `texts` must be exactly what was actually handed to the LLM for this
 * classify call (email body + the extracted text of every attachment that
 * was selected and actually forwarded) — an unselected or `failed`-extraction
 * attachment must not be included, or a quote sourced from material the AI
 * never saw would be mechanically "verified".
 *
 * Returned as one concatenated string rather than an array: the requirement
 * is only "is the quote a substring of what we sent", and a false positive
 * from a quote straddling the boundary between two source texts is an
 * acceptable trade-off for the simplicity (requirements §3.2.12(c) asks for
 * substring matching only, no boundary awareness).
 */
export function buildEvidenceCorpus(texts: string[]): string {
  return texts.map((text) => normalizeEvidenceText(text)).join('')
}

/**
 * Return a new `ExtractionPayload` with every `regional_eligibility[]`
 * element's `evidence_verified` set from a mechanical substring check against
 * `corpus`. Does not mutate `payload` (the caller — `classifyMail` — still
 * holds the pre-annotation result for `result.raw`, which must stay the AI's
 * literal response).
 *
 * `evidence_verified` is always recomputed here, even if the AI's JSON
 * happened to include the field (the Zod schema declares it `optional` only
 * so the same type serves both "AI output" and "annotated output" without a
 * second type) — the AI must never be trusted to grade its own quote.
 *
 * A `null` or whitespace-only `evidence_quote` (only valid on 「要確認」,
 * enforced by `ExtractionPayloadSchema`) always verifies to `false`: there is
 * nothing to mechanically check, and 「要確認」 already tells the reviewer to
 * look at the source themselves.
 */
export function annotateRegionalEvidence(
  payload: ExtractionPayload,
  corpus: string,
): ExtractionPayload {
  return {
    ...payload,
    events: payload.events.map((unit) => ({
      ...unit,
      regional_eligibility: unit.regional_eligibility.map((entry) => {
        const normalizedQuote =
          entry.evidence_quote === null ? '' : normalizeEvidenceText(entry.evidence_quote)
        const evidence_verified = normalizedQuote !== '' && corpus.includes(normalizedQuote)
        return { ...entry, evidence_verified }
      }),
    })),
  }
}
