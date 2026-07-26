'use client'

import { useEffect, useState } from 'react'
import type {
  EventUnit,
  ExtractionPayload,
} from '@kagetra/mail-worker/classify/schema'
import { composeTitle } from '@kagetra/mail-worker/classify/title'
import { EventForm } from '@/components/events/event-form'
import { Card } from '@/components/ui'
import { addDays } from '@/lib/jst-date'
import type { SeriesRow, TournamentKind } from '@/lib/edition/match'
import type { AttachmentChip } from './AttachmentList'
import {
  TournamentSeriesSelectSheet,
  type TournamentSeriesSelection,
} from './TournamentSeriesSelectSheet'

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
  /**
   * tournament-entry-rosters flow①: 開催(edition) 紐付けの pre-fill 候補（サーバで
   * 大会名から名寄せ・回次パースした結果）。型は inline（resolve.ts は DB 依存を持つので
   * client bundle へ引き込まない＝node-import 退行回避）。
   */
  editionSuggestion: {
    seriesId?: number | null
    seriesName: string
    editionNumber: number | null
    matched: boolean
  }
  seriesOptions?: SeriesRow[]
  /**
   * event-grade-group-broadcast タスク6: 「LINE告知に載せる要綱」の選択肢。
   * 候補はこのドラフトの元メール（tournament_drafts.message_id）の添付そのもの
   * （mail.attachments）。event スコープの loadGuidelineCandidates は承認前に
   * event が存在しないため使えない — [id]/page.tsx が既に読み込んでいる
   * mail.attachments をそのまま渡す。省略時は空配列（既存テストの互換のため
   * optional。実画面では [id]/page.tsx が常に渡す）。
   */
  attachmentCandidates?: readonly AttachmentChip[]
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
const EDITION_LABEL = 'block text-xs font-semibold text-ink-meta tracking-[0.02em]'
const EDITION_FIELD =
  'mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

export function ApprovalForm({
  payload,
  shortNameStem,
  registeredUnitKeys,
  editionSuggestion,
  seriesOptions = [],
  attachmentCandidates = [],
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
  const unitKinds = new Set(
    units
      .filter(
        (unit) =>
          registeredMap.has(unit.unit_key) ||
          (registered[unit.unit_key] ?? true),
      )
      .map((unit) => unit.kind ?? ('individual' as const)),
  )
  const hasMixedKinds = unitKinds.size > 1
  const editionKind = [...unitKinds][0] ?? 'individual'
  const compatibleSeriesOptions = hasMixedKinds
    ? []
    : seriesOptions.filter((series) => series.kind === editionKind)
  const initialSeriesId = compatibleSeriesOptions.some(
    (series) => series.id === editionSuggestion.seriesId,
  )
    ? (editionSuggestion.seriesId ?? null)
    : null
  const [editionLink, setEditionLink] = useState(
    initialSeriesId != null && editionSuggestion.editionNumber != null,
  )
  const [seriesSelection, setSeriesSelection] =
    useState<TournamentSeriesSelection>({
      query: editionSuggestion.seriesName,
      seriesId: initialSeriesId,
      createNew: false,
    })
  const [seriesSelectionKind, setSeriesSelectionKind] =
    useState<TournamentKind | null>(initialSeriesId != null ? editionKind : null)
  const [seriesSheetOpen, setSeriesSheetOpen] = useState(false)
  const selectedSeries = compatibleSeriesOptions.find(
    (series) => series.id === seriesSelection.seriesId,
  )

  useEffect(() => {
    const hasConfirmedSelection =
      seriesSelection.seriesId != null || seriesSelection.createNew
    if (!hasConfirmedSelection) return
    const existingSeriesIsCompatible =
      seriesSelection.seriesId == null || selectedSeries != null
    if (
      !hasMixedKinds &&
      seriesSelectionKind === editionKind &&
      existingSeriesIsCompatible
    ) {
      return
    }

    setSeriesSelection((current) => ({
      ...current,
      seriesId: null,
      createNew: false,
    }))
    setSeriesSelectionKind(null)
    setEditionLink(false)
  }, [
    editionKind,
    hasMixedKinds,
    selectedSeries,
    seriesSelection.createNew,
    seriesSelection.seriesId,
    seriesSelectionKind,
  ])

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-ink-2">
        この案内から {total} 件のイベントを作成します
        {registeredCount > 0 && `（うち登録済み ${registeredCount} 件）`}
      </div>

      <form action={action} className="flex flex-col gap-4">
        {/* tournament-entry-rosters flow①: 既存系列は検索結果の ID で確定し、検索語と
            選択状態を分離する。新規系列は 0 件時の明示確認だけ hidden field へ反映。 */}
        <Card>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                name="editionLink"
                checked={editionLink}
                onChange={(event) => setEditionLink(event.target.checked)}
                className="rounded border-border"
              />
              開催（第N回○○大会）に紐付ける
            </label>
            <input type="hidden" name="editionSeriesId" value={seriesSelection.seriesId ?? ''} />
            <input
              type="hidden"
              name="editionSeriesName"
              value={seriesSelection.createNew ? seriesSelection.query : ''}
            />
            {seriesSelection.createNew && (
              <input type="hidden" name="editionCreateNewSeries" value="on" />
            )}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
              <div className="min-w-0">
                <span className={EDITION_LABEL}>大会系列</span>
                <div className="mt-1 rounded-md border border-border-soft bg-surface-alt p-3">
                  {selectedSeries ? (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block text-xs text-ink-meta">選択済み</span>
                        <span className="block break-words text-sm font-semibold text-ink">
                          {selectedSeries.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSeriesSelection((current) => ({
                            ...current,
                            seriesId: null,
                            createNew: false,
                          }))
                          setSeriesSelectionKind(null)
                          setEditionLink(false)
                        }}
                        className="shrink-0 text-xs text-ink-meta underline"
                      >
                        解除
                      </button>
                    </div>
                  ) : seriesSelection.createNew ? (
                    <div>
                      <span className="block text-xs text-ink-meta">新規作成</span>
                      <span className="block break-words text-sm font-semibold text-ink">
                        {seriesSelection.query}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="block text-sm font-medium text-ink">系列は未選択です</span>
                      {seriesSelection.query && (
                        <span className="mt-0.5 block break-words text-xs text-ink-meta">
                          AI候補: {seriesSelection.query}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSeriesSheetOpen(true)}
                  disabled={hasMixedKinds}
                  className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-ink-2 hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
                >
                  系列を検索・選択
                </button>
                {hasMixedKinds && (
                  <p className="mt-1 text-xs text-danger">
                    個人戦と団体戦が混在しているため、1つの開催には紐づけられません。
                  </p>
                )}
              </div>
              <div>
                <label className={EDITION_LABEL}>回次</label>
                <input
                  name="editionNumber"
                  type="number"
                  min="1"
                  defaultValue={editionSuggestion.editionNumber ?? ''}
                  required={editionLink}
                  className={EDITION_FIELD}
                />
              </div>
            </div>
            {editionLink && !selectedSeries && !seriesSelection.createNew && (
              <p className="text-xs text-danger">
                開催へ紐づけるには、検索結果から既存系列を選ぶか新しい系列を明示してください。
              </p>
            )}
          </div>
        </Card>
        <TournamentSeriesSelectSheet
          open={seriesSheetOpen}
          kind={editionKind}
          seriesOptions={seriesOptions}
          selection={seriesSelection}
          onClose={() => setSeriesSheetOpen(false)}
          onConfirm={(selection) => {
            const hasConfirmedSelection =
              selection.seriesId != null || selection.createNew
            setSeriesSelection(selection)
            setSeriesSelectionKind(hasConfirmedSelection ? editionKind : null)
            setEditionLink(hasConfirmedSelection)
            setSeriesSheetOpen(false)
          }}
        />

        {/* event-grade-group-broadcast タスク6: 承認 1 回につき 1 件だけ選ぶ
            （unit ごとではなくフォーム全体）。デフォルトは未選択（「選択しない」）。
            候補が 0 件（元メールに添付が無い）なら空状態を出す。 */}
        <Card>
          <div className="flex flex-col gap-3">
            <span className="text-sm font-semibold text-ink">
              LINE告知に載せる要綱
            </span>
            {attachmentCandidates.length === 0 ? (
              <p className="text-xs text-ink-meta">添付がありません</p>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="gradeBroadcastAttachmentId"
                    value=""
                    defaultChecked
                    className="border-border"
                  />
                  選択しない
                </label>
                {attachmentCandidates.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 text-sm text-ink-2"
                  >
                    <input
                      type="radio"
                      name="gradeBroadcastAttachmentId"
                      value={a.id}
                      className="border-border"
                    />
                    <span className="truncate">{a.filename}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Card>

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
