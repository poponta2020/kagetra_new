import { describe, expect, it } from 'vitest'
import {
  ExtractionPayloadSchema,
  EventUnitSchema,
} from '../../src/classify/schema.js'

/**
 * Zod contract tests for the 2.0.0 array-shaped payload
 * (tournament-title-grade-split). Locks in: split (N units) / single (1 unit) /
 * noise (empty array) accept, and the legacy `extracted` shape + malformed
 * units reject.
 */
describe('ExtractionPayloadSchema (2.0.0 events[] shape)', () => {
  const baseUnit = {
    unit_key: 'u1',
    event_date: '2026-01-25',
    eligible_grades: ['A', 'B', 'C'],
    formal_name: '第11回東大阪競技かるた大会(ABC級)',
    venue: '東大阪市立体育館',
    fee_jpy: 3000,
    payment_deadline: null,
    payment_info_text: null,
    payment_method: null,
    entry_method: 'Google フォーム',
    organizer_text: '東大阪かるた協会',
    entry_deadline: '2026-01-10',
    kind: 'individual',
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
  }

  it('accepts a single-unit (same-day multi-grade) announcement', () => {
    const parsed = ExtractionPayloadSchema.parse({
      is_tournament_announcement: true,
      confidence: 0.96,
      reason: 'ok',
      is_correction: false,
      references_subject: null,
      short_name_stem: '東大阪',
      events: [baseUnit],
    })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.eligible_grades).toEqual(['A', 'B', 'C'])
    expect(parsed.short_name_stem).toBe('東大阪')
  })

  it('accepts a split (per-grade dates) announcement with 2 units', () => {
    const parsed = ExtractionPayloadSchema.parse({
      is_tournament_announcement: true,
      confidence: 0.95,
      reason: 'split by date',
      short_name_stem: '大阪',
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

  it('accepts a noise payload with an empty events array', () => {
    const parsed = ExtractionPayloadSchema.parse({
      is_tournament_announcement: false,
      confidence: 0.97,
      reason: 'not a tournament',
      short_name_stem: null,
      events: [],
    })
    expect(parsed.events).toEqual([])
    expect(parsed.short_name_stem).toBeNull()
  })

  it('rejects the legacy single `extracted` object shape (no events array)', () => {
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'legacy',
      extracted: { title: 'x', event_date: null },
    })
    // `events` is a required (non-optional) array — legacy payloads fail.
    expect(result.success).toBe(false)
  })

  it('rejects a unit with an out-of-range grade', () => {
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'bad grade',
      short_name_stem: '○○',
      events: [{ ...baseUnit, eligible_grades: ['A', 'F'] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a unit with a malformed event_date', () => {
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'bad date',
      short_name_stem: '○○',
      events: [{ ...baseUnit, event_date: '2026/01/25' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a unit missing unit_key', () => {
    const noKey: Record<string, unknown> = { ...baseUnit }
    delete noKey.unit_key
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'no key',
      short_name_stem: '○○',
      events: [noKey],
    })
    expect(result.success).toBe(false)
  })

  it('EventUnitSchema validates a well-formed unit directly', () => {
    expect(EventUnitSchema.parse(baseUnit).unit_key).toBe('u1')
  })

  it('rejects duplicate unit_key across events (review CRITICAL-2)', () => {
    // Two units sharing unit_key='u1' would collide the web form's
    // `${unit_key}__*` field namespaces and get Set-deduped server-side,
    // silently dropping one event.
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'dup key',
      short_name_stem: '大阪',
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
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'distinct keys',
      short_name_stem: '大阪',
      events: [
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-11' },
        { ...baseUnit, unit_key: 'u2', event_date: '2026-01-12' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a tournament announcement with an empty events array (review CRITICAL-2)', () => {
    // is_tournament_announcement=true but no units → downstream would render a
    // blank synthetic form and lose the AI's intent. Force the retry path.
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: true,
      confidence: 0.9,
      reason: 'tournament but no units',
      short_name_stem: '大阪',
      events: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /events\[\] is empty/.test(i.message)),
      ).toBe(true)
    }
  })

  it('still accepts noise (is_tournament_announcement=false + empty events)', () => {
    // The empty-events guard only applies to tournament announcements; noise
    // payloads legitimately carry `events: []`.
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: false,
      confidence: 0.9,
      reason: 'noise',
      short_name_stem: null,
      events: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a noise verdict that still carries events (review r2 should_fix)', () => {
    // is_tournament_announcement=false but events present → self-contradiction.
    // The classifier treats the boolean as authoritative and would drop these
    // events silently, so Zod must fail and take the retry path.
    const result = ExtractionPayloadSchema.safeParse({
      is_tournament_announcement: false,
      confidence: 0.9,
      reason: 'contradiction',
      short_name_stem: '大阪',
      events: [
        { ...baseUnit, unit_key: 'u1', event_date: '2026-01-11' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /events\[\] is non-empty/.test(i.message),
        ),
      ).toBe(true)
    }
  })
})
