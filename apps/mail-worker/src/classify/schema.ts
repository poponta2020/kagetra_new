import { z } from 'zod'

/**
 * Zod schema for the structured payload the LLM extractor returns when
 * classifying a mail message as a tournament announcement (or noise).
 *
 * This is the contract between the LLM provider implementation
 * (`AnthropicSonnet46Extractor`, future `Gemini…`) and the rest of the
 * pipeline — every provider must produce JSON that satisfies this shape, and
 * the classifier's Zod parse step is the single point at which malformed AI
 * output is rejected and the retry path is taken.
 *
 * Source of truth: `docs/features/tournament-title-grade-split/requirements.md`
 * §4.1. **PROMPT_VERSION 2.0.0 breaking change**: the old single `extracted`
 * object was replaced by `short_name_stem` + an `events[]` array of
 * `EventUnitSchema`. One announcement = 1 draft : N events (split per event
 * date). See `composeTitle()` for how the displayed `events.title` is derived.
 *
 * The grade enum is intentionally declared locally with the same value tuple
 * as `gradeEnum` in `packages/shared/src/schema/enums.ts` — drizzle's pgEnum is
 * a column-type generator, not a value list, so reusing it from a Zod schema
 * would couple the worker to drizzle internals for no payoff.
 *
 * Date fields stay as `string + regex(YYYY-MM-DD)` rather than `z.date()` to
 * keep the LLM tool-call payload trivially round-trippable as JSON, and to
 * match the JSON Schema we hand to Anthropic via `z.toJSONSchema`.
 */
const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date YYYY-MM-DD')
  .nullable()

/**
 * One event date = one event unit. Announcements that run different grades on
 * different dates are split into separate units; multiple grades on the SAME
 * date stay in one unit (their grades are joined in `eligible_grades`).
 *
 * The displayed tournament name (`events.title`) is NOT stored here — it is
 * derived deterministically from the announcement-wide `short_name_stem` and
 * this unit's `eligible_grades` via `composeTitle()`, so the grade-suffix order
 * never depends on the AI's output order and the title can be re-composed /
 * edited downstream.
 */
export const EventUnitSchema = z.object({
  /** Stable id ("u1","u2"…). Used to reconcile units across re-render and partial approval. */
  unit_key: z.string(),
  /** This unit's event date (the split key). null when unparseable (range-only text, etc.). */
  event_date: IsoDateSchema,
  /** Grades held on this date. Multiple same-day grades are merged here. null when absent/unknown. */
  eligible_grades: z.array(GradeSchema).nullable(),
  /** Formal name corresponding to this unit's grade(s) (→ `events.formal_name`). */
  formal_name: z.string().nullable(),
  venue: z.string().nullable(),
  fee_jpy: z.number().int().nullable(),
  payment_deadline: IsoDateSchema,
  payment_info_text: z.string().nullable(),
  payment_method: z.string().nullable(),
  entry_method: z.string().nullable(),
  organizer_text: z.string().nullable(),
  entry_deadline: IsoDateSchema,
  kind: z.enum(['individual', 'team']).nullable(),
  // Per-grade capacity only. The old announcement-wide `capacity_total` is
  // dropped — capacity is a per-grade value in practice.
  capacity_a: z.number().int().nullable(),
  capacity_b: z.number().int().nullable(),
  capacity_c: z.number().int().nullable(),
  capacity_d: z.number().int().nullable(),
  capacity_e: z.number().int().nullable(),
  official: z.boolean().nullable(),
})

export type EventUnit = z.infer<typeof EventUnitSchema>

export const ExtractionPayloadSchema = z.object({
  is_tournament_announcement: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  is_correction: z.boolean().optional(),
  references_subject: z.string().nullable().optional(),

  // Place-specific stem of "○○大会" (shared across the whole announcement),
  // with generic words stripped (第N回 / 全国 / 競技かるた / 選手権 …). The base
  // for title composition. null when no grade/place can be determined.
  short_name_stem: z.string().nullable(),

  // One or more units for a tournament announcement, `[]` for noise. One unit
  // per event date.
  events: z.array(EventUnitSchema),

  // Auxiliary raw text the AI surfaced. Not promoted to `events` rows on
  // approval — kept here for review-time context and future re-extraction.
  extras: z
    .object({
      fee_raw_text: z.string().nullable().optional(),
      eligible_grades_raw: z.string().nullable().optional(),
      target_grades_raw: z.string().nullable().optional(),
      local_rules_summary: z.string().nullable().optional(),
      timetable_summary: z.string().nullable().optional(),
    })
    .optional(),
})

export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>
