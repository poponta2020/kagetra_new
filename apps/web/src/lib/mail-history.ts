import type { HistoryEventRef, HistoryInput } from './mail-history.queries'
import { deriveEntryGroupName } from './entry-groups'

/**
 * mail-history: 会員向けメール検索の「処理の記録」導出（requirements.md §3.4 H0〜H6）。
 *
 * このファイルは**純関数のみ**を持つ（DB 非依存）。DB からの入力組み立ては
 * `mail-history.queries.ts`、H0（試合結果として取り込み）の判定・文言・クエリは
 * `mail-history.result-import.ts` に分離してある。
 *
 * ★AC-33（senseki-boundary 可搬性）: このファイルは `mail-history.result-import.ts` を
 * import しない。H0 は {@link deriveHistory} の `extraRows` 引数から**注入**される。
 * `mail-history.queries.ts` から `HistoryInput` / `HistoryEventRef` の型のみを
 * `import type` で参照している（型は erase されるため実行時の循環 import にはならない）。
 */

/** 履歴行の種別。H0〜H5 に対応（H6 は行を作らないので存在しない）。 */
export type HistoryKind =
  | 'result_import' // H0 試合結果として取り込み
  | 'draft_approved' // H1 大会案内として処理
  | 'broadcast' // H2 LINEグループへ配信
  | 'linked' // H3 紐付け（名簿種別で文言差し替え）
  | 'dismissed' // H4 / H5 対応不要として処理

/** 文章を構成する断片。描画側はこれを順に置くだけ。 */
export type HistorySegment =
  | { type: 'text'; value: string }
  | { type: 'eventLink'; eventId: number; label: string }

export interface HistoryRow {
  kind: HistoryKind
  /** 並べ替えと日付見出しに使う。null = H5（日付を出さない）。 */
  at: Date | null
  /** 詳細タイムライン本文。例: [eventLink('第46回九段大会AB'), text(' の案内として処理')] */
  segments: HistorySegment[]
  /** 詳細の2行目（H2 の '（本文と添付2件）'）。無ければ null。 */
  detail: string | null
  /** 控えめな注記（H5 の '処理日時の記録がありません'）。無ければ null。 */
  note: string | null
  /** 一覧カード末尾 `↳` 行用の短縮文。H2 だけ詳細と文言が違う。 */
  summarySegments: HistorySegment[]
}

const text = (value: string): HistorySegment => ({ type: 'text', value })
const eventLink = (eventId: number, label: string): HistorySegment => ({
  type: 'eventLink',
  eventId,
  label,
})

/**
 * H1 / H2 / H3 共通: イベント集合から表示ラベルのセグメント列を作る
 * （requirements.md §3.4「対象大会ラベルの共通規則」）。
 *
 * 1. `deriveEntryGroupName` で単一ラベルに畳めるなら、それ1つを表示し**開催日が
 *    最も早いイベント**（同着は id 昇順）へリンクする。★`selectRepresentativeEvent`
 *    は「次の開催日、無ければ最新」という別セマンティクスなのでここでは使わない。
 * 2. 畳めない場合は各イベントを開催日昇順（同着は id 昇順）で `・` 区切りに併記し、
 *    それぞれを自分の id へリンクする。
 * 3. 0件なら空配列（呼び出し側が文言から大会名部分を落とす）。
 */
function buildEventLabelSegments(events: readonly HistoryEventRef[]): HistorySegment[] {
  if (events.length === 0) return []

  const sorted = [...events].sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1
    return a.id - b.id
  })

  const collapsed = deriveEntryGroupName(sorted.map((e) => e.title))
  if (collapsed !== null) {
    const earliest = sorted[0]!
    return [eventLink(earliest.id, collapsed)]
  }

  const segments: HistorySegment[] = []
  sorted.forEach((e, index) => {
    if (index > 0) segments.push(text('・'))
    segments.push(eventLink(e.id, e.title))
  })
  return segments
}

/** H1: 大会案内として処理。 */
function buildDraftApprovedRow(draft: NonNullable<HistoryInput['draft']>): HistoryRow {
  const label = buildEventLabelSegments(draft.events)
  const segments = label.length > 0 ? [...label, text(' の案内として処理')] : [text('大会案内として処理')]
  return {
    kind: 'draft_approved',
    at: draft.approvedAt,
    segments,
    detail: null,
    note: null,
    summarySegments: segments,
  }
}

/** H2 の添付件数表示。include_body / 添付件数の4通り（requirements.md §3.4）。 */
function buildBroadcastDetail(includeBody: boolean, attachmentCount: number): string {
  if (includeBody && attachmentCount > 0) return `（本文と添付${attachmentCount}件）`
  if (!includeBody && attachmentCount > 0) return `（添付${attachmentCount}件）`
  // 添付0件は include_body の真偽に関わらず「本文のみ」（AC-14 は include_body=false
  // のとき「本文と」を含めないことだけを求めており、添付0件はこの表現で満たす）。
  return '（本文のみ）'
}

/** H2: LINEグループへ配信。 */
function buildBroadcastRow(broadcast: HistoryInput['broadcasts'][number]): HistoryRow {
  const label = buildEventLabelSegments(broadcast.events)
  const segments =
    label.length > 0
      ? [...label, text(' の連絡としてLINEグループへ配信')]
      : [text('LINEグループへ配信')]
  const summarySegments =
    label.length > 0 ? [...label, text(' の連絡としてLINE配信')] : [text('LINE配信')]
  return {
    kind: 'broadcast',
    at: broadcast.sentAt,
    segments,
    detail: buildBroadcastDetail(broadcast.includeBody, broadcast.attachmentCount),
    note: null,
    summarySegments,
  }
}

/** H3: 紐付け（名簿種別で文言差し替え）。 */
function buildLinkedRow(input: {
  triagedAt: Date | null
  mailKind: string | null
  linkedEvents: HistoryEventRef[]
}): HistoryRow {
  const label = buildEventLabelSegments(input.linkedEvents)
  const suffix =
    input.mailKind === 'applicant_roster'
      ? ' の申込名簿として処理'
      : input.mailKind === 'confirmed_roster'
        ? ' の確定名簿として処理'
        : ' の連絡として紐付け'
  const fallback =
    input.mailKind === 'applicant_roster'
      ? '申込名簿として処理'
      : input.mailKind === 'confirmed_roster'
        ? '確定名簿として処理'
        : '大会に紐付け'
  const segments = label.length > 0 ? [...label, text(suffix)] : [text(fallback)]
  return {
    kind: 'linked',
    at: input.triagedAt,
    segments,
    detail: null,
    note: null,
    summarySegments: segments,
  }
}

/** H4 / H5: 対応不要として処理。`triagedAt` の有無で日付付き/無しに分岐する。 */
function buildDismissedRow(triagedAt: Date | null): HistoryRow {
  if (triagedAt !== null) {
    const segments = [text('対応不要として処理')]
    return {
      kind: 'dismissed',
      at: triagedAt,
      segments,
      detail: null,
      note: null,
      summarySegments: segments,
    }
  }
  // H5: migration 0018 の一括処理済み化で triaged_at が入らなかった既存67通。
  // 日付を捏造せず省略し、控えめな注記だけ添える。
  const segments = [text('対応不要として処理済み')]
  return {
    kind: 'dismissed',
    at: null,
    segments,
    detail: null,
    note: '処理日時の記録がありません',
    summarySegments: segments,
  }
}

/** 同時刻の行を安定させるための種別優先度（AC-19 の並び順規則）。 */
const KIND_ORDER: Record<HistoryKind, number> = {
  result_import: 0,
  draft_approved: 1,
  linked: 2,
  broadcast: 3,
  dismissed: 4,
}

function sortHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  return [...rows].sort((a, b) => {
    const aTime = a.at === null ? Number.POSITIVE_INFINITY : a.at.getTime()
    const bTime = b.at === null ? Number.POSITIVE_INFINITY : b.at.getTime()
    if (aTime !== bTime) return aTime - bTime
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  })
}

/**
 * requirements.md §3.4 の H0〜H6 を導出する。1通のメールにつき履歴行を日時昇順で返す。
 *
 * `extraRows` は H0（試合結果として取り込み）の注入口。`mail-history.queries.ts` が
 * `loadResultImportRows` の結果をここへ渡す。**H4/H5 の判定は `extraRows` も見る**
 * （AC-32: H1〜H3 が0行 かつ `extraRows` が空のときだけ「対応不要として処理」を出す。
 * 結果取込済みメールに誤って「対応不要」を出さないため）。
 *
 * `extraRows` を渡さずに呼んでも H1〜H6 は成立する（AC-33: senseki-boundary 物理削除の
 * 可搬性）。
 */
export function deriveHistory(
  input: HistoryInput,
  extraRows: readonly HistoryRow[] = [],
): HistoryRow[] {
  // H6: 未処理は履歴行なし（一覧・詳細は「未処理」ピルのみを出す）。
  if (input.triageStatus === 'unprocessed') return []

  const rows: HistoryRow[] = [...extraRows]

  if (input.draft !== null) {
    rows.push(buildDraftApprovedRow(input.draft))
  }

  const hasBroadcasts = input.broadcasts.length > 0
  for (const broadcast of input.broadcasts) {
    rows.push(buildBroadcastRow(broadcast))
  }

  // H3 は H2 が無いときだけ出す。
  if (!hasBroadcasts && input.linkedEvents.length > 0) {
    rows.push(
      buildLinkedRow({
        triagedAt: input.triagedAt,
        mailKind: input.mailKind,
        linkedEvents: input.linkedEvents,
      }),
    )
  }

  // H1〜H3（と H0＝extraRows）のいずれも無ければ「対応不要」に落ちる（消去法。
  // requirements.md §7 の設計判断の根拠を参照）。
  if (rows.length === 0) {
    rows.push(buildDismissedRow(input.triagedAt))
  }

  return sortHistoryRows(rows)
}
