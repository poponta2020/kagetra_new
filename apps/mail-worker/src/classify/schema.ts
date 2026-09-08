import { z } from 'zod'
import {
  REGIONAL_ELIGIBILITY_GRADES,
  REGIONAL_VERDICTS,
  VERDICT_NEEDS_REVIEW,
} from './regional.js'

/**
 * Zod schema for the structured payload the LLM extractor returns for a mail
 * an administrator has already judged to be a tournament announcement.
 *
 * This is the contract between the LLM provider implementation
 * (`AnthropicExtractor`, future `Gemini…`) and the rest of the pipeline —
 * every provider must produce JSON that satisfies this shape, and the
 * classifier's Zod parse step is the single point at which malformed AI
 * output is rejected and the retry path is taken.
 *
 * Source of truth: `docs/features/mail-ai-extract-refinements/requirements.md`
 * §3.2.2. **PROMPT_VERSION 3.0.0 breaking change**: classification left the
 * AI's job entirely (cron no longer runs AI; the admin presses 「会で流す」only
 * on mails they have already recognised as announcements), so
 * `is_tournament_announcement` / `confidence` / `is_correction` /
 * `references_subject` / `short_name_stem` are gone, along with `fee_jpy`
 * (derivable from the grade — see `packages/shared` fee constants).
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
 * State of the transfer deadline, kept separate from the date itself.
 *
 * A bare `payment_deadline: null` conflated two situations that need opposite
 * follow-up: the announcement said "we will tell you the account after the
 * lottery" (nothing to chase) versus the AI could not read a date that is
 * printed somewhere (a human should open the original). The三値 makes them
 * mechanically distinguishable, and is carried through to
 * `events.payment_deadline_kind` on approval so the entry board keeps the
 * distinction after the draft is gone (requirements §3.2.7).
 *
 * Japanese values on purpose: they are shown to the reviewer verbatim, and the
 * DB side owns the English `fixed` / `later_notice` / `unspecified` enum.
 */
const PaymentDeadlineKindSchema = z.enum(['日付あり', '後日連絡', '記載なし'])

/**
 * Closed Japanese enums instead of free text. The values observed in practice
 * cluster into these few, and free text accumulates spelling variants that make
 * later aggregation impossible. Emitting Japanese directly keeps the display
 * path short (no identifier→label map in the UI).
 */
const PaymentMethodSchema = z.enum(['口座振込', '現地支払い', 'その他']).nullable()
const EntryMethodSchema = z
  .enum(['Excel申込書', 'Googleフォーム', 'メール', 'その他'])
  .nullable()

/**
 * D・E 級の地域制限判定（mail-ai-extract-refinements §3.2.12）。その単位の
 * `eligible_grades` に含まれる D・E だけを対象に **1 級 1 要素**。D・E を含まない
 * 単位は空配列。
 *
 *   - `verdict` は `classify/regional.ts` の 4 値（制限なし／北海道は対象／
 *     北海道は対象外／要確認）。
 *   - `evidence_quote` は判定の根拠にした箇所を **資料から一字一句そのまま**
 *     抜き出したもの。ワーカーが本文＋選択添付の抽出テキストと機械照合するので、
 *     要約・整形されると照合に失敗して「未照合」に倒れる（それが設計）。
 *     「要確認」だけは根拠が無い（記載が見当たらない）ときに null を許す。
 *   - `evidence_verified` は **ワーカー専用**の照合結果。AI には見せない
 *     （`llm/anthropic.ts` が Anthropic へ渡す input_schema からこの項目だけを
 *     削る）。Zod では同じスキーマに optional で持ち、型を二重化しない。AI が
 *     もし出力しても `annotateRegionalEvidence` が全要素を上書きする。
 */
export const RegionalEligibilitySchema = z.object({
  grade: z.enum(REGIONAL_ELIGIBILITY_GRADES),
  verdict: z.enum(REGIONAL_VERDICTS),
  evidence_quote: z.string().nullable(),
  evidence_verified: z.boolean().optional(),
})

export type RegionalEligibility = z.infer<typeof RegionalEligibilitySchema>

/**
 * One event date = one event unit. Announcements that run different grades on
 * different dates are split into separate units; multiple grades on the SAME
 * date stay in one unit (their grades are joined in `eligible_grades`).
 *
 * The displayed tournament name (`events.title`) is NOT stored here — the
 * reviewer types a short 通称 ("大阪") once in the approval form and
 * `composeTitle()` derives each unit's title from it and this unit's
 * `eligible_grades`, so the grade-suffix order never depends on the AI.
 */
export const EventUnitSchema = z.object({
  /**
   * Stable id ("u1","u2"…). Used to reconcile units across re-render and
   * partial approval, and as the web form field namespace (`${unit_key}__*`).
   * review r2 should_fix: pin the format the prompt asks for so an empty or
   * exotic string can't break the form namespace / materialize matching.
   */
  unit_key: z.string().regex(/^u[1-9]\d*$/, 'unit_key must be "u1", "u2", …'),
  /** This unit's event date (the split key). null when unparseable (range-only text, etc.). */
  event_date: IsoDateSchema,
  /** Grades held on this date. Multiple same-day grades are merged here. null when absent/unknown. */
  eligible_grades: z.array(GradeSchema).nullable(),
  /**
   * Formal name corresponding to this unit's grade(s) (→ `events.formal_name`).
   * Doubles as the inbox card's display name now that `short_name_stem` is gone.
   */
  formal_name: z.string().nullable(),
  venue: z.string().nullable(),
  payment_deadline: IsoDateSchema,
  payment_deadline_kind: PaymentDeadlineKindSchema,
  payment_info_text: z.string().nullable(),
  payment_method: PaymentMethodSchema,
  entry_method: EntryMethodSchema,
  organizer_text: z.string().nullable(),
  entry_deadline: IsoDateSchema,
  kind: z.enum(['individual', 'team']).nullable(),
  /**
   * Announcement-wide capacity ("定員100名") → `events.capacity`. Extracted only
   * when stated; never back-computed from the per-grade numbers (and vice
   * versa — see the prompt's 逆算禁止 rule).
   */
  capacity_total: z.number().int().nullable(),
  capacity_a: z.number().int().nullable(),
  capacity_b: z.number().int().nullable(),
  capacity_c: z.number().int().nullable(),
  capacity_d: z.number().int().nullable(),
  capacity_e: z.number().int().nullable(),
  official: z.boolean().nullable(),
  /**
   * D・E 級の地域制限判定（§3.2.12）。**必須・空配列可**。forced tool use で
   * 必ず埋まるので optional にしない（省略を許すと「判定を忘れた」と「D・E が
   * 無い」が区別できなくなる）。3.0.x 以前のドラフトは Web 層が防御的に読む。
   */
  regional_eligibility: z.array(RegionalEligibilitySchema),
})

export type EventUnit = z.infer<typeof EventUnitSchema>

export const ExtractionPayloadSchema = z
  .object({
    /**
     * Review-facing extraction memo ("級別の定員が読み取れなかった" 等). Since
     * 3.0.0 this is no longer a justification of a classification verdict — it
     * is what the human reviewer reads first. When `source_mismatch` is true it
     * must say why the material looked wrong.
     */
    reason: z.string(),

    /**
     * True when the material handed over is plainly a different kind of
     * document (an entrant roster, a venue map…). **This is not classification
     * coming back under another name**: the AI is never asked "is this a
     * tournament announcement", only to speak up when what it was given is
     * obviously not the requested material. The draft is still created as
     * `pending_review` and approval is never blocked (requirements §3.2.6).
     */
    source_mismatch: z.boolean().nullable().optional(),

    // One unit per event date. At least one is always required — an
    // administrator only triggers extraction on mails they have already judged
    // to be announcements, so an empty split is an extraction failure.
    events: z.array(EventUnitSchema),

    // Auxiliary raw text the AI surfaced. Not promoted to `events` rows on
    // approval — kept here for review-time context and future re-extraction.
    extras: z
      .object({
        eligible_grades_raw: z.string().nullable().optional(),
        target_grades_raw: z.string().nullable().optional(),
      })
      .optional(),
  })
  // Cross-field invariants that a flat object schema can't express:
  //
  //   1. At least one event unit. The noise branch of this check is gone with
  //      classification (2.x allowed `false` + `[]`); an empty `events` would
  //      render a synthetic blank form downstream and silently drop the AI's
  //      split — better to fail Zod and take the retry path.
  //   2. `unit_key` must be unique across `events`. The web approval form keys
  //      its per-unit fields by `unit_key` (`${unit_key}__title`, …) and the
  //      server de-dupes via a Set, so a duplicate key collides form values and
  //      drops one unit. Reject duplicates here so a bad AI payload retries
  //      instead of producing a one-event-short approval.
  //   3. `payment_deadline_kind: "日付あり"` with no `payment_deadline` is
  //      self-contradictory and would map to an `events` row that violates the
  //      DB CHECK on approval. Fail here instead of at INSERT time.
  //   4. `regional_eligibility[].grade` must be unique within a unit (one
  //      verdict per grade — a duplicate would make the approval form's
  //      "remove this grade" decision ambiguous), and every verdict other than
  //      「要確認」 must carry a non-blank `evidence_quote` (the worker's
  //      evidence check and the reviewer's warning both need the quote).
  //   5. The set of `regional_eligibility[].grade` must equal the D・E subset
  //      of `eligible_grades` (empty when `eligible_grades` is null). A
  //      missing verdict is the dangerous case: the approval form would show
  //      no warning and keep the grade checked, so an AI omission would turn
  //      straight into a human omission (Codex review, PR #618). Rejecting it
  //      here takes the same retry → `ai_failed` path as every other contract
  //      violation instead of silently producing a clean-looking draft.
  .superRefine((val, ctx) => {
    if (val.events.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'events[] is empty (expected at least one unit)',
        path: ['events'],
      })
    }

    const seen = new Set<string>()
    val.events.forEach((unit, i) => {
      if (seen.has(unit.unit_key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate unit_key "${unit.unit_key}" in events[] (unit_key must be unique)`,
          path: ['events', i, 'unit_key'],
        })
      }
      seen.add(unit.unit_key)

      if (unit.payment_deadline_kind === '日付あり' && unit.payment_deadline === null) {
        ctx.addIssue({
          code: 'custom',
          message:
            'payment_deadline_kind is "日付あり" but payment_deadline is null (a date is required)',
          path: ['events', i, 'payment_deadline'],
        })
      }

      const expectedGrades = new Set<string>(
        (unit.eligible_grades ?? []).filter((g) =>
          (REGIONAL_ELIGIBILITY_GRADES as readonly string[]).includes(g),
        ),
      )
      const seenGrades = new Set<string>()
      unit.regional_eligibility.forEach((re, j) => {
        if (!expectedGrades.has(re.grade)) {
          ctx.addIssue({
            code: 'custom',
            message: `regional_eligibility grade "${re.grade}" is not in events[${i}].eligible_grades (judge only the D・E grades the unit actually holds)`,
            path: ['events', i, 'regional_eligibility', j, 'grade'],
          })
        }
        if (seenGrades.has(re.grade)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate regional_eligibility grade "${re.grade}" in events[${i}] (one entry per grade)`,
            path: ['events', i, 'regional_eligibility', j, 'grade'],
          })
        }
        seenGrades.add(re.grade)

        if (
          re.verdict !== VERDICT_NEEDS_REVIEW &&
          (re.evidence_quote === null || re.evidence_quote.trim() === '')
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `regional_eligibility verdict "${re.verdict}" requires a non-empty evidence_quote (only "${VERDICT_NEEDS_REVIEW}" may omit it)`,
            path: ['events', i, 'regional_eligibility', j, 'evidence_quote'],
          })
        }
      })

      for (const grade of expectedGrades) {
        if (!seenGrades.has(grade)) {
          ctx.addIssue({
            code: 'custom',
            message: `missing regional_eligibility entry for grade "${grade}" in events[${i}] (every D・E grade in eligible_grades needs a verdict)`,
            path: ['events', i, 'regional_eligibility'],
          })
        }
      }
    })
  })

export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>
