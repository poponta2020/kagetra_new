import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ExtractionPayloadSchema,
  EventUnitSchema,
} from '../../src/classify/schema.js'

/**
 * Zod contract tests for the 3.0.0 payload (mail-ai-extract-refinements).
 * Locks in: classification fields are gone, `events` is always required to be
 * non-empty, the new 振込締切状態 / 全体定員 fields, and the closed Japanese
 * enums for 支払い方法 / 申込方法.
 */
describe('ExtractionPayloadSchema (3.0.0 shape)', () => {
  const baseUnit = {
    unit_key: 'u1',
    event_date: '2026-01-25',
    eligible_grades: ['A', 'B', 'C'],
    formal_name: '第11回東大阪競技かるた大会(ABC級)',
    venue: '東大阪市立体育館',
    payment_deadline: null,
    payment_deadline_kind: '記載なし',
    payment_info_text: null,
    payment_method: null,
    entry_method: 'Googleフォーム',
    organizer_text: '東大阪かるた協会',
    entry_deadline: '2026-01-10',
    kind: 'individual',
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
  }

  it('accepts a single-unit (same-day multi-grade) announcement', () => {
    const parsed = ExtractionPayloadSchema.parse({
      reason: 'ok',
      events: [baseUnit],
    })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.eligible_grades).toEqual(['A', 'B', 'C'])
    expect(parsed.events[0]?.formal_name).toBe('第11回東大阪競技かるた大会(ABC級)')
  })

  it('accepts a split (per-grade dates) announcement with 2 units', () => {
    const parsed = ExtractionPayloadSchema.parse({
      reason: 'split by date',
      events: [
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-11', eligible_grades: ['B'], capacity_b: 64 },
        { ...baseUnit, unit_key: 'u2', event_date: '2026-01-12', eligible_grades: ['C'], capacity_c: 48 },
      ],
    })
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]?.event_date).toBe('2026-01-11')
    expect(parsed.events[1]?.event_date).toBe('2026-01-12')
    expect(parsed.events[1]?.capacity_c).toBe(48)
  })

  // ── AC-1 / AC-2: 撤去したフィールドが input_schema に残っていないこと ──
  it('AC-1/AC-2: the generated tool input_schema carries none of the removed fields', () => {
    const json = z.toJSONSchema(ExtractionPayloadSchema, {
      target: 'draft-7',
      io: 'input',
    }) as Record<string, unknown>
    const flat = JSON.stringify(json)

    for (const removed of [
      'is_tournament_announcement',
      'confidence',
      'short_name_stem',
      'is_correction',
      'references_subject',
      'fee_jpy',
      'fee_raw_text',
      'local_rules_summary',
      'timetable_summary',
    ]) {
      expect(flat).not.toContain(removed)
    }
    // …and the replacements are present.
    expect(flat).toContain('source_mismatch')
    expect(flat).toContain('payment_deadline_kind')
    expect(flat).toContain('capacity_total')
  })

  it('AC-3: rejects an empty events array unconditionally (no noise escape hatch)', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'no units',
      events: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /events\[\] is empty/.test(i.message)),
      ).toBe(true)
    }
  })

  it('AC-4: rejects duplicate unit_key across events', () => {
    // Two units sharing unit_key='u1' would collide the web form's
    // `${unit_key}__*` field namespaces and get Set-deduped server-side,
    // silently dropping one event.
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'dup key',
      events: [
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-11' },
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-12' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => /duplicate unit_key/.test(i.message))).toBe(
        true,
      )
    }
  })

  it('accepts distinct unit_keys across events', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'distinct keys',
      events: [
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-11' },
        { ...baseUnit, unit_key: 'u2', event_date: '2026-01-12' },
      ],
    })
    expect(result.success).toBe(true)
  })

  // ── AC-8: payment_deadline_kind ──
  it('AC-8: accepts the three payment_deadline_kind values and rejects anything else', () => {
    for (const kind of ['日付あり', '後日連絡', '記載なし']) {
      const deadline = kind === '日付あり' ? '2026-01-20' : null
      const result = ExtractionPayloadSchema.safeParse({
        reason: 'kind',
        events: [{ ...baseUnit, payment_deadline: deadline, payment_deadline_kind: kind }],
      })
      expect(result.success).toBe(true)
    }
    const bad = ExtractionPayloadSchema.safeParse({
      reason: 'kind',
      events: [{ ...baseUnit, payment_deadline_kind: 'fixed' }],
    })
    expect(bad.success).toBe(false)
  })

  it('AC-8: rejects payment_deadline_kind="日付あり" with a null payment_deadline', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'contradiction',
      events: [{ ...baseUnit, payment_deadline: null, payment_deadline_kind: '日付あり' }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /payment_deadline is null/.test(i.message)),
      ).toBe(true)
    }
  })

  it('accepts 後日連絡 with a null payment_deadline', () => {
    const parsed = ExtractionPayloadSchema.parse({
      reason: '抽選後に振込先を連絡',
      events: [{ ...baseUnit, payment_deadline: null, payment_deadline_kind: '後日連絡' }],
    })
    expect(parsed.events[0]?.payment_deadline_kind).toBe('後日連絡')
  })

  // ── AC-10 / AC-11: 閉じた日本語 enum ──
  it('AC-10: payment_method accepts only 口座振込 / 現地支払い / その他 / null', () => {
    for (const value of ['口座振込', '現地支払い', 'その他', null]) {
      const result = ExtractionPayloadSchema.safeParse({
        reason: 'method',
        events: [{ ...baseUnit, payment_method: value }],
      })
      expect(result.success).toBe(true)
    }
    const bad = ExtractionPayloadSchema.safeParse({
      reason: 'method',
      events: [{ ...baseUnit, payment_method: 'bank_transfer' }],
    })
    expect(bad.success).toBe(false)
  })

  it('AC-11: entry_method accepts only Excel申込書 / Googleフォーム / メール / その他 / null', () => {
    for (const value of ['Excel申込書', 'Googleフォーム', 'メール', 'その他', null]) {
      const result = ExtractionPayloadSchema.safeParse({
        reason: 'entry',
        events: [{ ...baseUnit, entry_method: value }],
      })
      expect(result.success).toBe(true)
    }
    const bad = ExtractionPayloadSchema.safeParse({
      reason: 'entry',
      events: [{ ...baseUnit, entry_method: 'Google フォーム' }],
    })
    expect(bad.success).toBe(false)
  })

  it('accepts capacity_total alongside per-grade capacities', () => {
    const parsed = ExtractionPayloadSchema.parse({
      reason: '全体定員と級別定員が併記',
      events: [{ ...baseUnit, capacity_total: 100, capacity_a: 40, capacity_b: 60 }],
    })
    expect(parsed.events[0]?.capacity_total).toBe(100)
    expect(parsed.events[0]?.capacity_a).toBe(40)
  })

  it('accepts source_mismatch: true (extras narrowed to the two raw-text fields)', () => {
    const parsed = ExtractionPayloadSchema.parse({
      reason: '渡された PDF は出場者名簿に見える',
      source_mismatch: true,
      events: [baseUnit],
      extras: { eligible_grades_raw: 'A級〜C級', target_grades_raw: null },
    })
    expect(parsed.source_mismatch).toBe(true)
    expect(parsed.extras?.eligible_grades_raw).toBe('A級〜C級')
  })

  it('rejects the legacy single `extracted` object shape (no events array)', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'legacy',
      extracted: { title: 'x', event_date: null },
    })
    // `events` is a required (non-optional) array — legacy payloads fail.
    expect(result.success).toBe(false)
  })

  it('rejects a unit with an out-of-range grade', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'bad grade',
      events: [{ ...baseUnit, eligible_grades: ['A', 'F'] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a unit with a malformed event_date', () => {
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'bad date',
      events: [{ ...baseUnit, event_date: '2026/01/25' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a unit missing unit_key', () => {
    const noKey: Record<string, unknown> = { ...baseUnit }
    delete noKey.unit_key
    const result = ExtractionPayloadSchema.safeParse({
      reason: 'no key',
      events: [noKey],
    })
    expect(result.success).toBe(false)
  })

  it('EventUnitSchema validates a well-formed unit directly', () => {
    expect(EventUnitSchema.parse(baseUnit).unit_key).toBe('u1')
  })
})
