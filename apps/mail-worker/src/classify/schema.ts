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
 * Source of truth: `docs/features/mail-tournament-import/requirements.md` §4.1
 * (the `ExtractionPayloadSchema` block). The grade enum is intentionally
 * declared locally with the same value tuple as `gradeEnum` in
 * `packages/shared/src/schema/enums.ts` — drizzle's pgEnum is a column-type
 * generator, not a value list, so reusing it from a Zod schema would couple
 * the worker to drizzle internals for no payoff.
 *
 * Date fields stay as `string + regex(YYYY-MM-DD)` rather than `z.date()` to
 * keep the LLM tool-call payload trivially round-trippable as JSON, and to
 * match the JSON Schema we hand to Anthropic via `zod-to-json-schema`.
 */
const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date YYYY-MM-DD')
  .nullable()

export const ExtractionPayloadSchema = z.object({
  is_tournament_announcement: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  is_correction: z.boolean().optional(),
  references_subject: z.string().nullable().optional(),

  extracted: z.object({
    title: z.string().nullable(),
    formal_name: z.string().nullable(),
    event_date: IsoDateSchema,
    venue: z.string().nullable(),
    fee_jpy: z.number().int().nullable(),
    payment_deadline: IsoDateSchema,
    payment_info_text: z.string().nullable(),
    payment_method: z.string().nullable(),
    entry_method: z.string().nullable(),
    organizer_text: z.string().nullable(),
    entry_deadline: IsoDateSchema,
    eligible_grades: z.array(GradeSchema).nullable(),
    kind: z.enum(['individual', 'team']).nullable(),
    capacity_total: z.number().int().nullable(),
    capacity_a: z.number().int().nullable(),
    capacity_b: z.number().int().nullable(),
    capacity_c: z.number().int().nullable(),
    capacity_d: z.number().int().nullable(),
    capacity_e: z.number().int().nullable(),
    official: z.boolean().nullable(),
  }),

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
