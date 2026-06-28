'use client'

import { useState } from 'react'
import type {
  EventUnit,
  ExtractionPayload,
} from '@kagetra/mail-worker/classify/schema'
import { composeTitle } from '@kagetra/mail-worker/classify/title'
import { EventForm } from '@/components/events/event-form'
import { Card } from '@/components/ui'
import { addDays } from '@/lib/jst-date'

/**
 * 会内締切デフォルト = 大会申込締切の 6 日前。会内で参加者を取りまとめて
 * 主催者へ申し込むためのリードタイム（運用ルール）。承認画面の prefill
 * 専用で、登録後の編集画面では連動しない。
 */
const INTERNAL_DEADLINE_LEAD_DAYS = 6

/**
 * tournament-title-grade-split: one event unit ready for the approval form.
 * Always the new `EventUnit` shape — old single-`extracted` payloads are
 * normalized into a one-element array (`unit_key='u1'`) by {@link normalizeUnits}.
 */
export type NormalizedUnit = EventUnit

export interface ApprovalFormProps {
  /** Raw payload (new or old format). null for ai_failed / empty drafts. */
  payload: ExtractionPayload | null
  /** Announcement-wide place stem used to compose each unit's title. */
  shortNameStem: string | null
  /** Already-materialized units (event already created). Rendered read-only. */
  registeredUnitKeys: { unitKey: string; eventId: number }[]
  action: (formData: FormData) => void | Promise<void>
}

/**
 * Old-format ExtractionPayload carried a single `extracted` object. The web
 * layer still has to render pending drafts persisted before the 2.0.0 bump,
 * so map that object into one `EventUnit` (requirements §3.4 後方互換).
 */
interface LegacyExtracted {
  title?: string | null
  formal_name?: string | null
  event_date?: string | null
  venue?: string | null
  fee_jpy?: number | null
  payment_deadline?: string | null
  payment_info_text?: string | null
  payment_method?: string | null
  entry_method?: string | null
  organizer_text?: string | null
  entry_deadline?: string | null
  eligible_grades?: ('A' | 'B' | 'C' | 'D' | 'E')[] | null
  kind?: 'individual' | 'team' | null
  capacity_a?: number | null
  capacity_b?: number | null
  capacity_c?: number | null
  capacity_d?: number | null
  capacity_e?: number | null
  official?: boolean | null
}

/**
 * Normalize a payload (new `events[]` or legacy `extracted`) into a list of
 * `EventUnit`. Returns a single empty-ish unit for a null/ai_failed payload so
 * the operator still gets a blank form to fill in (mirrors the old behavior
 * where ApprovalForm always rendered one EventForm).
 */
export function normalizeUnits(payload: ExtractionPayload | null): NormalizedUnit[] {
  if (payload && Array.isArray(payload.events) && payload.events.length > 0) {
    return payload.events
  }
  // Legacy single-object payload (or null). Build one synthetic unit.
  const legacy =
    payload && 'extracted' in payload
      ? ((payload as { extracted?: LegacyExtracted }).extracted ?? null)
      : null
  return [
    {
      unit_key: 'u1',
      event_date: legacy?.event_date ?? null,
      eligible_grades: legacy?.eligible_grades ?? null,
      formal_name: legacy?.formal_name ?? null,
      venue: legacy?.venue ?? null,
      fee_jpy: legacy?.fee_jpy ?? null,
      payment_deadline: legacy?.payment_deadline ?? null,
      payment_info_text: legacy?.payment_info_text ?? null,
      payment_method: legacy?.payment_method ?? null,
      entry_method: legacy?.entry_method ?? null,
      organizer_text: legacy?.organizer_text ?? null,
      entry_deadline: legacy?.entry_deadline ?? null,
      kind: legacy?.kind ?? null,
      capacity_a: legacy?.capacity_a ?? null,
      capacity_b: legacy?.capacity_b ?? null,
      capacity_c: legacy?.capacity_c ?? null,
      capacity_d: legacy?.capacity_d ?? null,
      capacity_e: legacy?.capacity_e ?? null,
      official: legacy?.official ?? null,
    },
  ]
}

/**
 * Renders one {@link EventForm} per AI-extracted event unit inside a single
 * `<form action={action}>` so all selected units submit together. Each unit
 * carries a hidden `unit_key` input + a "このイベントを登録する" checkbox
 * (default ON). Already-materialized units render as read-only summaries.
 *
 * title pre-fill = `composeTitle(shortNameStem, unit.eligible_grades)`; for a
 * legacy payload with no stem we fall back to the legacy `extracted.title`.
 *
 * Client component (review CRITICAL-1): the per-unit register checkbox is
 * controlled, and an unchecked unit's `EventForm` is wrapped in a
 * `<fieldset disabled>`. A disabled fieldset removes its inner inputs from the
 * submitted FormData AND from HTML constraint validation, so an unselected
 * unit whose `eventDate`/`title` the AI couldn't fill never blocks the submit
 * (the partial-approval / シナリオ C path). The server action
 * (`extractEventUnitsFormData`) already keys off `${unit_key}__register`, so a
 * deselected unit is ignored end-to-end.
 */
export function ApprovalForm({
  payload,
  shortNameStem,
  registeredUnitKeys,
  action,
}: ApprovalFormProps) {
  const units = normalizeUnits(payload)
  const registeredMap = new Map(
    registeredUnitKeys.map((r) => [r.unitKey, r.eventId]),
  )

  // register state for the not-yet-materialized units only (registered units
  // render read-only and don't participate in the submit).
  const [registered, setRegistered] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      units
        .filter((u) => !registeredMap.has(u.unit_key))
        .map((u) => [u.unit_key, true]),
    ),
  )

  // Legacy title fallback: when there's no stem (old payload), use the AI's
  // full `extracted.title` so the form isn't blank.
  const legacyTitle =
    payload && 'extracted' in payload
      ? ((payload as { extracted?: LegacyExtracted }).extracted?.title ?? null)
      : null

  const total = units.length
  const registeredCount = units.filter((u) =>
    registeredMap.has(u.unit_key),
  ).length

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-ink-2">
        この案内から {total} 件のイベントを作成します
        {registeredCount > 0 && `（うち登録済み ${registeredCount} 件）`}
      </div>

      <form action={action} className="flex flex-col gap-4">
        {units.map((unit) => {
          const registeredEventId = registeredMap.get(unit.unit_key)
          // New short-name = stem(場所) + grades. Only compose when a stem
          // exists (new-format payloads always carry one). For a legacy payload
          // with no stem, composeTitle(null, ['A']) would yield a bare 'A', so
          // prefer the AI's full title there instead.
          const stem = (shortNameStem ?? '').trim()
          const composedTitle =
            stem !== ''
              ? composeTitle(shortNameStem, unit.eligible_grades)
              : (legacyTitle ?? composeTitle(shortNameStem, unit.eligible_grades))

          if (registeredEventId != null) {
            // Already materialized: read-only, no editable form. We still
            // forward the unit_key so the server action can recount.
            return (
              <Card key={unit.unit_key}>
                <input type="hidden" name="unit_key" value={unit.unit_key} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-success-fg">
                    登録済み
                  </span>
                  <span className="font-medium text-ink">
                    {composedTitle || '(無題)'}
                  </span>
                  <span className="text-ink-meta">
                    （events #{registeredEventId}）
                  </span>
                  {unit.event_date && (
                    <span className="text-ink-meta">{unit.event_date}</span>
                  )}
                </div>
              </Card>
            )
          }

          const prefix = `${unit.unit_key}__`
          const isChecked = registered[unit.unit_key] ?? true
          return (
            <Card key={unit.unit_key}>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    name={`${prefix}register`}
                    checked={isChecked}
                    onChange={(e) =>
                      setRegistered((s) => ({
                        ...s,
                        [unit.unit_key]: e.target.checked,
                      }))
                    }
                    className="rounded border-border"
                  />
                  このイベントを登録する
                  {unit.event_date && (
                    <span className="ml-1 text-xs font-normal text-ink-meta">
                      ({unit.event_date})
                    </span>
                  )}
                </label>
                {/* unit_key marker for extractEventUnitsFormData — kept OUTSIDE
                    the disabled fieldset so it is always submitted (the server
                    counts it for materialize tracking; register gating happens
                    via the `${prefix}register` checkbox above). */}
                <input type="hidden" name="unit_key" value={unit.unit_key} />
                {/* Unchecked → disabled fieldset → inner inputs skip submit and
                    HTML required validation (review CRITICAL-1). */}
                <fieldset
                  disabled={!isChecked}
                  className="m-0 border-0 p-0 disabled:opacity-50"
                >
                  <EventForm
                    mode="create"
                    action={action}
                    cancelHref="/admin/mail-inbox"
                    fieldPrefix={prefix}
                    defaultValues={{
                      title: composedTitle,
                      formalName: unit.formal_name ?? null,
                      eventDate: unit.event_date ?? null,
                      location: unit.venue ?? null,
                      feeJpy: unit.fee_jpy ?? null,
                      paymentDeadline: unit.payment_deadline ?? null,
                      paymentInfo: unit.payment_info_text ?? null,
                      paymentMethod: unit.payment_method ?? null,
                      entryMethod: unit.entry_method ?? null,
                      organizer: unit.organizer_text ?? null,
                      entryDeadline: unit.entry_deadline ?? null,
                      internalDeadline: unit.entry_deadline
                        ? addDays(unit.entry_deadline, -INTERNAL_DEADLINE_LEAD_DAYS)
                        : null,
                      eligibleGrades: unit.eligible_grades ?? null,
                      kind: unit.kind ?? 'individual',
                      // EventUnit has no announcement-wide capacity; per-grade only.
                      capacity: null,
                      capacityA: unit.capacity_a ?? null,
                      capacityB: unit.capacity_b ?? null,
                      capacityC: unit.capacity_c ?? null,
                      capacityD: unit.capacity_d ?? null,
                      capacityE: unit.capacity_e ?? null,
                      official: unit.official ?? true,
                    }}
                  />
                </fieldset>
              </div>
            </Card>
          )
        })}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            選択したイベントを登録
          </button>
        </div>
      </form>
    </div>
  )
}
