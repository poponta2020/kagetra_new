import { describe, expect, it } from 'vitest'
import {
  annotateRegionalEvidence,
  buildEvidenceCorpus,
  normalizeEvidenceText,
} from '../../src/classify/evidence.js'
import { VERDICT_HOME_INELIGIBLE, VERDICT_NEEDS_REVIEW } from '../../src/classify/regional.js'
import type { EventUnit, ExtractionPayload, RegionalEligibility } from '../../src/classify/schema.js'

/**
 * Pure-function tests (no DB) for the mechanical evidence-quote check
 * (mail-ai-extract-refinements §3.2.12(c) / AC-68 / AC-69). `classifier.test.ts`
 * covers the DB-backed end-to-end wiring (attachment selection → corpus →
 * `evidence_verified` on the persisted draft); this file covers the
 * normalisation/matching logic itself in isolation.
 */

function buildRegionalEligibility(
  overrides: Partial<RegionalEligibility> = {},
): RegionalEligibility {
  return {
    grade: 'D',
    verdict: VERDICT_HOME_INELIGIBLE,
    evidence_quote: '北海道は対象外の一文',
    ...overrides,
  }
}

function buildUnit(overrides: Partial<EventUnit> = {}): EventUnit {
  return {
    unit_key: 'u1',
    event_date: null,
    eligible_grades: ['D', 'E'],
    formal_name: null,
    venue: null,
    payment_deadline: null,
    payment_deadline_kind: '記載なし',
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    kind: null,
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
    regional_eligibility: [buildRegionalEligibility()],
    ...overrides,
  }
}

function buildPayload(events: EventUnit[]): ExtractionPayload {
  return {
    reason: 'unit test',
    source_mismatch: null,
    events,
  }
}

describe('normalizeEvidenceText', () => {
  it('removes half-width and full-width whitespace, and NFKC-normalizes full-width alnum', () => {
    // AC-68 ケース4: PDF 抽出テキストは「202 6 年」のように数字の間に空白が
    // 混じることがある。全角スペース(U+3000)・改行も除去対象。
    expect(normalizeEvidenceText('202 6　年\nです')).toBe('2026年です')
    // 全角英数を半角へ正規化する（NFKC）。
    expect(normalizeEvidenceText('２０２６年Ｄ級')).toBe('2026年D級')
  })

  it('treats zero-width space and BOM as whitespace to strip', () => {
    expect(normalizeEvidenceText('近畿​支部﻿及び')).toBe('近畿支部及び')
  })
})

describe('buildEvidenceCorpus', () => {
  it('normalizes and concatenates every text', () => {
    expect(buildEvidenceCorpus(['202 6　年', 'です'])).toBe('2026年です')
  })

  it('returns an empty string for an empty list or a list of empty strings', () => {
    expect(buildEvidenceCorpus([])).toBe('')
    expect(buildEvidenceCorpus([''])).toBe('')
  })
})

describe('annotateRegionalEvidence (AC-68)', () => {
  it('verifies an exact-match quote', () => {
    const corpus = buildEvidenceCorpus(['本大会は北海道在住者は対象外です。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '北海道在住者は対象外です。' }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(true)
  })

  it('does not verify a paraphrased/ellipsis quote (AC-68 ケース2)', () => {
    const corpus = buildEvidenceCorpus([
      '近畿支部及び隣接県（鳥取、岡山、徳島）の会所属の選手に限る。',
    ])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '近畿支部及び隣接県…の会所属' }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(false)
  })

  it('does not verify against an empty corpus (AC-68 ケース3)', () => {
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '北海道在住者は対象外です。' }),
        ],
      }),
    ])

    expect(
      annotateRegionalEvidence(payload, buildEvidenceCorpus([])).events[0]!
        .regional_eligibility[0]!.evidence_verified,
    ).toBe(false)
    expect(
      annotateRegionalEvidence(payload, buildEvidenceCorpus([''])).events[0]!
        .regional_eligibility[0]!.evidence_verified,
    ).toBe(false)
  })

  it('verifies through whitespace/full-width-space/newline noise in the corpus (AC-68 ケース4)', () => {
    const corpus = buildEvidenceCorpus(['本大会は202 6　年に\n開催します。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [buildRegionalEligibility({ evidence_quote: '2026年' })],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(true)
  })

  it('verifies even when the quote itself carries whitespace', () => {
    const corpus = buildEvidenceCorpus(['本大会は2026年に開催します。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '202 6　年' }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(true)
  })

  it('treats full-width and half-width alnum as equivalent (NFKC)', () => {
    const corpus = buildEvidenceCorpus(['２０２６年度はＤ級の出場資格を制限します。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '2026年度はD級の出場資格を制限します。' }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(true)
  })

  it('treats a null evidence_quote (要確認) as unverified', () => {
    const corpus = buildEvidenceCorpus(['何らかの本文'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ verdict: VERDICT_NEEDS_REVIEW, evidence_quote: null }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(false)
  })

  it('treats a whitespace-only evidence_quote as unverified', () => {
    const corpus = buildEvidenceCorpus(['何らかの本文'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [buildRegionalEligibility({ evidence_quote: '　\n  ' })],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(false)
  })

  it('overwrites an AI-supplied evidence_verified: true when the corpus does not contain the quote', () => {
    const corpus = buildEvidenceCorpus(['これは全く関係ない本文です。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({
            evidence_quote: '北海道在住者は対象外です。',
            evidence_verified: true,
          }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(false)
  })

  it('annotates every element across multiple units, and leaves a D・E-less unit (empty array) untouched', () => {
    const corpus = buildEvidenceCorpus([
      '北海道在住者は対象外です。',
      '北海道在住者は対象です。',
    ])
    const payload = buildPayload([
      buildUnit({
        unit_key: 'u1',
        regional_eligibility: [
          buildRegionalEligibility({ grade: 'D', evidence_quote: '北海道在住者は対象外です。' }),
          buildRegionalEligibility({ grade: 'E', evidence_quote: '北海道在住者は対象です。' }),
        ],
      }),
      buildUnit({ unit_key: 'u2', eligible_grades: ['A'], regional_eligibility: [] }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated.events[0]!.regional_eligibility[0]!.evidence_verified).toBe(true)
    expect(annotated.events[0]!.regional_eligibility[1]!.evidence_verified).toBe(true)
    expect(annotated.events[1]!.regional_eligibility).toEqual([])
  })

  it('does not mutate the input payload', () => {
    const corpus = buildEvidenceCorpus(['北海道在住者は対象外です。'])
    const payload = buildPayload([
      buildUnit({
        regional_eligibility: [
          buildRegionalEligibility({ evidence_quote: '北海道在住者は対象外です。' }),
        ],
      }),
    ])

    const annotated = annotateRegionalEvidence(payload, corpus)

    expect(annotated).not.toBe(payload)
    expect(annotated.events[0]).not.toBe(payload.events[0])
    expect(annotated.events[0]!.regional_eligibility[0]).not.toBe(
      payload.events[0]!.regional_eligibility[0],
    )
    expect(payload.events[0]!.regional_eligibility[0]!.evidence_verified).toBeUndefined()
  })
})
