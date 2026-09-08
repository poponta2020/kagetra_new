'use client'

import { useEffect, useState } from 'react'
import type {
  EventUnit,
  ExtractionPayload,
} from '@kagetra/mail-worker/classify/schema'
import { composeTitle } from '@kagetra/mail-worker/classify/title'
import { EventForm } from '@/components/events/event-form'
import { Card } from '@/components/ui'
import { paymentDeadlineKindFromPayload } from '@/lib/events/payment-deadline'
import { addDays } from '@/lib/jst-date'
// entry-groups タスク7: クラスタ規則は backfill / 承認フォームの自動提案で同一
// (clusterEventsByEntryGroup が正)。ここでは提案の「初期値」だけを計算する — 実際に
// events / entry_groups を作るのはサーバー側 (admin/mail-inbox/actions.ts) で、そちらが
// 同じ関数を使って部分承認の収束まで行う。
//
// ★import 元は `@/lib/entry-group-cluster`（DB 非依存の leaf モジュール）であること。
// `@/lib/entry-groups` は `@kagetra/shared/schema` と drizzle を**値** import するので、
// この `'use client'` ファイルから引くと schema がクライアントバンドルへ載る
// （eslint / vitest / check-types では検知できず `next build` で初めて壊れる種類の事故）。
import { clusterEventsByEntryGroup } from '@/lib/entry-group-cluster'
import {
  searchSeriesCandidates,
  type SeriesRow,
  type TournamentKind,
} from '@/lib/edition/match'
import { planRegionalEligibility } from '../regional-eligibility-utils'
import type { AttachmentChip } from './AttachmentList'
import { RegionalEligibilityNotice } from './RegionalEligibilityNotice'
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
/**
 * 承認フォームが扱う単位。3.0.0 の {@link EventUnit} をベースにしつつ、**既存
 * ドラフトを開いても壊れない**ように 2 点だけ緩めてある（AC-34）:
 *
 * - `payment_method` / `entry_method` は 3.0.0 で閉じた日本語 enum になったが、
 *   2.x のドラフトには `"bank_transfer"` のような英語識別子が保存されている。
 *   どちらもフォームの自由入力欄へ流すだけなので `string | null` で受ける。
 * - `fee_jpy` は 3.0.0 で抽出項目から外した（級から決定的に導出できるため）が、
 *   2.x のドラフトは値を持っている。参加費欄は手入力として残るので、既存値が
 *   あれば初期値として拾う。
 *
 * mail-ai-extract-refinements §3.2.12 / AC-70〜75: `regional_eligibility` は
 * `EventUnit` では必須だが、正規化ユニットでは **optional** にする — 旧形式
 * ドラフトを 1 単位へ合成する `normalizeUnits` の legacy 分岐はこのフィールドを
 * 持たない値を作る（判定を持たないドラフトとして `planRegionalEligibility` に
 * そのまま渡す）。
 */
export type NormalizedUnit = Omit<
  EventUnit,
  'payment_method' | 'entry_method' | 'regional_eligibility'
> & {
  payment_method: string | null
  entry_method: string | null
  fee_jpy?: number | null
  regional_eligibility?: EventUnit['regional_eligibility']
}

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
    /**
     * mail-ai-extract-refinements タスク2: 採用した系列の通称（`tournament_series.
     * short_name`）。通称欄の自動投入元（AC-45〜48）。**optional** なのは
     * `ApprovalForm.test.tsx` の既存 `editionSuggestion` リテラル（20箇所超）を
     * 無改変で通すため。生成側（`buildEditionSuggestion`）は常に値を入れる。
     */
    seriesShortName?: string | null
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
      // 旧形式に状態フィールドは無いので、日付の有無から素直に導く。
      payment_deadline_kind: legacy?.payment_deadline ? '日付あり' : '記載なし',
      payment_info_text: legacy?.payment_info_text ?? null,
      payment_method: legacy?.payment_method ?? null,
      entry_method: legacy?.entry_method ?? null,
      organizer_text: legacy?.organizer_text ?? null,
      entry_deadline: legacy?.entry_deadline ?? null,
      kind: legacy?.kind ?? null,
      capacity_total: null,
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
  // まだ events 化されていない（＝これから登録する）ユニットだけがグループ割当の対象。
  const editableUnits = units.filter((u) => !registeredMap.has(u.unit_key))

  // register state for the not-yet-materialized units only (registered units
  // render read-only and don't participate in the submit).
  //
  // mail-ai-extract-refinements §3.2.12 / AC-73: D・E のみの単位で両方が照合済み
  // 対象外（=対象級が全て外れる）なら既定 OFF にする。「この日の全ての級が
  // 北海道の選手は出場できないため、登録対象から外しました」の案内と対にする —
  // 管理者はチェックを戻せば通常どおり登録できる。
  const [registered, setRegistered] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      editableUnits.map((u) => [
        u.unit_key,
        !planRegionalEligibility(u).allRemoved,
      ]),
    ),
  )

  // entry-groups タスク7: 自動グループ提案の初期値。承認フォームのユニットは同一 draft
  // なので、clusterEventsByEntryGroup の効果は実質「申込締切が同じユニットをまとめる」
  // になる（tournamentDraftId は全ユニットに固定値を渡す）。エラーケース: ユニットが
  // 1件だけなら UI を出さない（シングルトン自動生成のまま）。
  const [groupKeyByUnit, setGroupKeyByUnit] = useState<Record<string, string>>(
    () => {
      if (editableUnits.length <= 1) return {}
      const clusters = clusterEventsByEntryGroup(
        editableUnits.map((u) => ({
          unitKey: u.unit_key,
          tournamentDraftId: 0,
          entryDeadline: u.entry_deadline ?? null,
        })),
      )
      const map: Record<string, string> = {}
      clusters.forEach((cluster, i) => {
        for (const u of cluster) map[u.unitKey] = `g${i}`
      })
      return map
    },
  )

  // Legacy title fallback: when there's no stem (old payload), use the AI's
  // full `extracted.title` so the form isn't blank.
  const legacyTitle =
    payload && 'extracted' in payload
      ? ((payload as { extracted?: LegacyExtracted }).extracted?.title ?? null)
      : null

  // mail-ai-extract-refinements タスク2: 通称⇄系列連動のため、系列種別（kind）に
  // まつわる計算を通称の初期値決定より前に置く（AC-45〜47 は「kind 適合チェックを
  // 通った初期候補のときだけ通称も自動投入する」ため、initialSeriesId が先に要る）。
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

  // mail-ai-extract-refinements §3.2.3 / AC-15〜17・45〜48: 通称は AI ではなく
  // **人が入力する**。「大阪」「札幌」程度の地名だけを1回打てば、各単位の大会名が
  // `composeTitle(通称, eligible_grades)` で合成される（AC-15）。合成ロジック
  // 自体は変えていない —— stem の供給元が AI から人間に変わっただけ。
  //
  // 初期値の優先順位（AC-45〜47）:
  //   1. `shortNameStem` prop（2.x の既存ドラフトを開いたときだけ値が入る）
  //   2. kind 適合チェックを通った初期候補（`initialSeriesId`）があれば、その系列の
  //      通称（`editionSuggestion.seriesShortName`）。系列は名寄せ候補が1件のときしか
  //      採用されない（`buildEditionSuggestion`）ので、ここが埋まるのは「候補1件」の
  //      ケースだけ（AC-47: 候補0件/複数件では `initialSeriesId` が null のままなので
  //      通称も空）。
  //   3. どちらも無ければ空。
  const initialNickname =
    shortNameStem && shortNameStem.trim() !== ''
      ? shortNameStem
      : initialSeriesId != null
        ? (editionSuggestion.seriesShortName ?? '')
        : ''
  // AC-48: 系列の通称を自動投入したときだけ由来（系列名）を出す。人が打ち直したら
  // 消える（下の JSX 側で「現在値が自動投入した値と一致するあいだだけ表示」を判定）。
  const autoFilledNicknameFromSeries =
    (!shortNameStem || shortNameStem.trim() === '') && initialSeriesId != null
      ? (editionSuggestion.seriesShortName ?? null)
      : null
  const [nickname, setNickname] = useState(initialNickname)
  // 単位ごとの個別上書き（AC-16）。未設定＝合成結果をそのまま使う。通称を打ち
  // 直すと、上書きしていない単位だけが追随する。
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})

  const trimmedNickname = nickname.trim()
  /**
   * 単位の大会名。通称が未入力のあいだは**空**にする（AC-17）——
   * `composeTitle(null, ['B'])` は級だけの「B」を返してしまい、無意味な値が
   * 入ったまま登録される事故になるため。旧形式ペイロードだけは AI のフルタイトルを
   * フォールバックに使う。
   */
  // mail-ai-extract-refinements §3.2.12 / AC-70: 照合済みの「北海道は対象外」で
  // 外れた級は `composeTitle` の入力にも反映する（兵庫 A〜E → 「兵庫ABC」）。
  // 登録済み（materialize 済み）の単位には何もしない（AC-75）— 読み取り専用
  // サマリーの表示名まで級を落とすと、実際に登録した大会名と食い違って見える。
  const composedTitleOf = (unit: NormalizedUnit): string =>
    trimmedNickname !== ''
      ? composeTitle(
          trimmedNickname,
          registeredMap.has(unit.unit_key)
            ? unit.eligible_grades
            : planRegionalEligibility(unit).effectiveGrades,
        )
      : (legacyTitle ?? '')
  const titleOf = (unit: NormalizedUnit): string =>
    titleOverrides[unit.unit_key] ?? composedTitleOf(unit)

  const total = units.length
  const registeredCount = units.filter((u) =>
    registeredMap.has(u.unit_key),
  ).length
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

  // AC-49〜52: 通称欄からの候補チップ。通称が空・混在 kind のときは出さない
  // （searchSeriesCandidates は空クエリで同種別の全系列を返す仕様のため、空ガードが
  // 必須 — 忘れると入力前から全系列が並んでしまう）。
  const nicknameSeriesCandidates =
    trimmedNickname !== '' && !hasMixedKinds
      ? searchSeriesCandidates(trimmedNickname, seriesOptions, editionKind).slice(0, 3)
      : []

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
        {/* mail-ai-extract-refinements §3.2.3 / AC-15〜17・45〜52: 通称の人力入力＋
            系列との双方向連動。 */}
        <Card>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="approval-nickname"
              className="text-sm font-semibold text-ink"
            >
              通称
            </label>
            <input
              id="approval-nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例: 大阪"
              className="rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {/* AC-48: 系列の通称を自動投入したときだけ由来を出す。打ち直したら消える。 */}
            {autoFilledNicknameFromSeries != null &&
              nickname === autoFilledNicknameFromSeries && (
                <p className="text-xs text-ink-meta">
                  「{editionSuggestion.seriesName}」の通称を入れました
                </p>
              )}
            {/* AC-49〜52: 通称からの系列候補チップ。タップしても通称欄は変化しない
                （AC-50）— 系列選択のみを更新する。 */}
            {nicknameSeriesCandidates.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {nicknameSeriesCandidates.map(({ series }) => (
                  <button
                    key={series.id}
                    type="button"
                    // 既に選ばれている系列のチップは押しても状態が変わらないので、
                    // 押せそうに見えたまま無反応にならないよう選択状態を出す。
                    aria-pressed={seriesSelection.seriesId === series.id}
                    onClick={() => {
                      setSeriesSelection({
                        query: series.name,
                        seriesId: series.id,
                        createNew: false,
                      })
                      setSeriesSelectionKind(editionKind)
                      setEditionLink(true)
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      seriesSelection.seriesId === series.id
                        ? 'border-brand bg-brand-bg font-semibold text-ink'
                        : 'border-border-soft bg-surface-alt text-ink-2 hover:bg-brand-bg'
                    }`}
                  >
                    {series.shortName
                      ? `${series.shortName}（${series.name}）`
                      : series.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-meta">
              地名だけを入れてください。各イベントの大会名が「大阪B」「大阪C」のように
              自動で合成されます（個別に書き換えることもできます）。
            </p>
          </div>
        </Card>

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
            {/* 新規作成時だけ通称を運ぶ。既存系列選択時は short_name を書き換えない
                （createConfirmedSeries 側の契約: §3.2.9(d)）。 */}
            <input
              type="hidden"
              name="editionSeriesShortName"
              value={seriesSelection.createNew ? nickname.trim() : ''}
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
            // AC-53: 既存系列が確定し通称が空なら short_name を入れる。新規作成
            // (createNew) のときは入れない。既に入力があれば触らない。
            if (
              selection.seriesId != null &&
              !selection.createNew &&
              trimmedNickname === ''
            ) {
              const confirmed = compatibleSeriesOptions.find(
                (series) => series.id === selection.seriesId,
              )
              if (confirmed?.shortName) {
                setNickname(confirmed.shortName)
              }
            }
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

        {/* entry-groups タスク7: 同一 draft × 同一申込締切での自動グループ提案
            （AC-20）。ユニットが1件だけなら出さない（§エラーケース。シングルトン
            自動生成のまま）。「開催紐付け」「要綱選択」の Card と同列の配置。 */}
        {editableUnits.length > 1 && (
          <Card>
            <div className="flex flex-col gap-3">
              <span className="text-sm font-semibold text-ink">申込グループ</span>
              <p className="text-[13px] text-ink-meta">
                同じ申込締切のユニットは自動的に同じグループに提案されます。
                ユニットごとに割当先を変更できます。
              </p>
              <div className="flex flex-col gap-2">
                {editableUnits.map((unit) => {
                  const unitLabel = titleOf(unit) || `単位 ${unit.unit_key}`
                  const currentKey =
                    groupKeyByUnit[unit.unit_key] ?? `solo:${unit.unit_key}`
                  const optionKeys = Array.from(
                    new Set(Object.values(groupKeyByUnit)),
                  )
                  if (!optionKeys.includes(currentKey)) {
                    optionKeys.push(currentKey)
                  }
                  const labelByKey = new Map(
                    optionKeys.map((key, i) => [key, `グループ${i + 1}`]),
                  )
                  return (
                    <div
                      key={unit.unit_key}
                      className="flex items-center justify-between gap-2 text-sm text-ink-2"
                    >
                      <span className="min-w-0 truncate">
                        {unitLabel || '(無題)'}
                        {unit.entry_deadline && (
                          <span className="ml-1 text-[13px] text-ink-meta">
                            (締切: {unit.entry_deadline})
                          </span>
                        )}
                      </span>
                      <select
                        name={`${unit.unit_key}__group_key`}
                        value={currentKey}
                        onChange={(e) => {
                          const value = e.target.value
                          setGroupKeyByUnit((s) => ({
                            ...s,
                            [unit.unit_key]:
                              value === '__new__'
                                ? `solo:${unit.unit_key}`
                                : value,
                          }))
                        }}
                        className="rounded-md border border-border bg-canvas px-2 py-1 text-[13px] text-ink"
                      >
                        {optionKeys.map((key) => (
                          <option key={key} value={key}>
                            {labelByKey.get(key)}
                          </option>
                        ))}
                        <option value="__new__">新規グループ</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        )}

        {units.map((unit) => {
          const registeredEventId = registeredMap.get(unit.unit_key)
          // New short-name = stem(場所) + grades. Only compose when a stem
          // exists (new-format payloads always carry one). For a legacy payload
          // with no stem, composeTitle(null, ['A']) would yield a bare 'A', so
          // prefer the AI's full title there instead.
          const composedTitle = titleOf(unit)

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
          // mail-ai-extract-refinements §3.2.12 / AC-70〜75: 単位ごとに 1 回だけ
          // 計算し、対象級の初期値・大会名合成・警告表示の全てで同じ結果を使う。
          const plan = planRegionalEligibility(unit)
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
                {/* mail-ai-extract-refinements §3.2.12 / AC-71〜75: fieldset の
                    外に置く — 未チェック（登録しない）でも読める。 */}
                <RegionalEligibilityNotice plan={plan} />
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
                  {/* mail-ai-extract-refinements AC-39: payload の日本語3値を
                      events.payment_deadline_kind（英語 enum）へ写す。承認フォームは
                      状態の select を出さない（日付は下の EventForm で編集でき、
                      サーバー側 normalizePaymentDeadline が日付を正として整合させる）
                      ので、hidden で運ぶ。 */}
                  <input
                    type="hidden"
                    name={`${prefix}paymentDeadlineKind`}
                    value={paymentDeadlineKindFromPayload(
                      unit.payment_deadline_kind,
                    )}
                  />
                  <EventForm
                    mode="create"
                    action={action}
                    cancelHref="/admin/mail-inbox"
                    fieldPrefix={prefix}
                    titleValue={composedTitle}
                    onTitleChange={(value) =>
                      setTitleOverrides((s) => ({ ...s, [unit.unit_key]: value }))
                    }
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
                      // mail-ai-extract-refinements §3.2.12 / AC-70: 照合済みの
                      // 「北海道は対象外」で外れた級はチェック済みにしない。
                      eligibleGrades: plan.effectiveGrades ?? null,
                      kind: unit.kind ?? 'individual',
                      // mail-ai-extract-refinements: 全体定員（capacity_total）を
                      // events.capacity へ。級別は capacity_a〜e のまま併存する
                      // （どちらか一方からの逆算はしない）。
                      capacity: unit.capacity_total ?? null,
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
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-ink-on-brand hover:bg-brand-hover"
          >
            選択したイベントを登録
          </button>
        </div>
      </form>
    </div>
  )
}
