import type { Grade } from '@kagetra/shared/types'

/**
 * 申込管理ボード（`/admin/entries`）の仕分け・並び順・締切表示の純関数。
 *
 * `Date.now()` を呼ばない。サーバーが JST の `todayStr` を渡し、クライアントは
 * それを使って同じ結果を描く（hydration mismatch を避ける。`event-list-utils.ts`
 * と同じ方針）。要件: docs/features/entry-management/requirements.md §3.2
 */

export type EntryStatus = 'not_applied' | 'applied' | 'not_applying'
export type PaymentType = 'advance' | 'onsite' | null
export type PaymentStatus = 'unpaid' | 'paid'

/** エリア識別子（要件 §3.2.3）。 */
export type AreaId =
  | 'action_required'
  | 'payment_due'
  /** 申込済で確定名簿がまだ出ていない。抽選待ちもここに含む。 */
  | 'applied_waiting'
  | 'before_deadline'
  | 'done'
  | 'no_applicants'

/**
 * ボードに区画として描かれる ID（＝{@link AREAS} に載っている ID）。
 * `no_applicants` は「どの区画にも出さない」ことを表すだけの分類結果なので含まない。
 */
export type VisibleAreaId = Exclude<AreaId, 'no_applicants'>

export interface EntryBoardItem {
  id: number
  /** 正式名称。通称が引けないときのフォールバックにのみ使う。 */
  title: string
  /**
   * 大会系列の通称（`tournament_series.short_name`）。
   * events → edition → series で辿る。edition 未紐付けの大会では null。
   */
  shortName: string | null
  eventDate: string
  eligibleGrades: Grade[] | null
  internalDeadline: string | null
  entryDeadline: string | null
  paymentDeadline: string | null
  lotteryDate: string | null
  entryStatus: EntryStatus
  paymentType: PaymentType
  paymentStatus: PaymentStatus
  attendCount: number
  hasConfirmedRoster: boolean
}

export interface AreaDef {
  id: VisibleAreaId
  label: string
  /** 各行に出している締切の種類（区画見出しの右端に小さく置く）。 */
  deadlineHint: string
  /** 行動が必要なエリアか（見出しの強調に使う）。 */
  actionable: boolean
  /**
   * 残日数を出さない区画。まだ手を動かす段階ではなく、日付だけ分かれば
   * 十分なフェーズ（抽選待ち・完了）で false にする。
   */
  showCountdown?: boolean
  /** 見出しタップで開閉できる区画。 */
  collapsible?: boolean
  /**
   * 既定で畳んでおく区画（`collapsible` 前提）。管理者が能動的に見る必要が
   * なく、畳むことで上の区画を 1 画面に収める余裕が生まれる区画に立てる。
   */
  collapsedByDefault?: boolean
}

/**
 * 上から**大会が進む順（ライフサイクル順）**に並べる。
 * 締切前 → 要対応 → 申込済み・抽選待ち → 名簿確定・振込待ち → 完了。
 * 緊急度順ではなく進行順に固定することで、「どの大会がどのフェーズにいるか」を
 * 上から下へ読み下せるようにする。
 */
export const AREAS: readonly AreaDef[] = [
  {
    id: 'before_deadline',
    label: '締切前',
    deadlineHint: '会内締切',
    actionable: false,
    // まだ手を動かす段階ではないので畳めるようにする。ただし出欠の集まり
    // 具合を眺めるのが主用途なので、既定は開いたまま。
    collapsible: true,
  },
  {
    id: 'action_required',
    label: '要対応',
    // 会内締切は既に過ぎている区画なので、見るべきは主催者への申込締切
    // （＝本締切）。ここを落とすと申込漏れが確定する。
    deadlineHint: '本締切',
    actionable: true,
  },
  {
    id: 'applied_waiting',
    label: '申込済み・抽選待ち',
    deadlineHint: '抽選日',
    actionable: false,
    showCountdown: false,
  },
  {
    id: 'payment_due',
    label: '名簿確定・振込待ち',
    deadlineHint: '支払締切',
    actionable: true,
  },
  {
    id: 'done',
    label: '完了',
    deadlineHint: '開催日',
    actionable: false,
    showCountdown: false,
  },
]

/**
 * ボードに出さない区画。`classify` は分類自体は返すが、ここに含まれる区画の
 * 大会はボードから除外する（管理者がもう手を動かすことがないため）。
 * 手動で「申し込まない」にした大会もここに落ちる。
 */
const HIDDEN_AREAS: ReadonlySet<AreaId> = new Set<AreaId>(['no_applicants'])

/** 型述語。true 側を弾くと残りが {@link VisibleAreaId} に絞られる。 */
function isHiddenArea(area: AreaId): area is Exclude<AreaId, VisibleAreaId> {
  return HIDDEN_AREAS.has(area)
}

/**
 * 一覧に出す表示名 = 通称 + 級（例「札幌AB」）。正式名称は使わない。
 * 通称が引けない大会（edition 未紐付け）は正式名称にフォールバックする。
 */
export function displayName(item: EntryBoardItem): string {
  const base = item.shortName ?? item.title
  const grades = item.eligibleGrades?.join('') ?? ''
  return `${base}${grades}`
}

/** 基準締切 = 会内締切、未入力なら大会申込締切で代替（要件 §3.2.2）。 */
export function baseDeadlineOf(item: EntryBoardItem): string | null {
  return item.internalDeadline ?? item.entryDeadline
}

/**
 * 大会をちょうど 1 つのエリアへ振り分ける（要件 §3.2.3）。
 * 条件は相互排他なので評価順は可読性のためだけのもの。
 */
export function classify(item: EntryBoardItem, todayStr: string): AreaId {
  if (item.entryStatus === 'not_applying') return 'no_applicants'

  if (item.entryStatus === 'not_applied') {
    const base = baseDeadlineOf(item)
    // 締切未設定 or 締切当日以前 → 締切前（当日は「超過していない」）
    if (base == null || base >= todayStr) return 'before_deadline'
    return item.attendCount >= 1 ? 'action_required' : 'no_applicants'
  }

  // entryStatus === 'applied'
  // 確定名簿がまだ出ていない＝抽選待ちも名簿待ちも同じ「待ち」として 1 区画に畳む
  if (!item.hasConfirmedRoster) return 'applied_waiting'
  if (item.paymentType === 'advance' && item.paymentStatus === 'unpaid') {
    return 'payment_due'
  }
  return 'done'
}

/** エリアごとの並び順キー（要件 §3.2.3）。null は末尾。 */
export function sortKeyOf(
  item: EntryBoardItem,
  area: AreaId,
  todayStr: string,
): string | null {
  switch (area) {
    case 'action_required':
      return item.entryDeadline
    case 'applied_waiting':
      return item.lotteryDate
    case 'payment_due':
      return item.paymentDeadline
    case 'done':
      return item.eventDate
    default:
      return baseDeadlineOf(item)
  }
}

/** 昇順・null 末尾・開催日を副キー（非破壊）。 */
export function sortArea(
  items: EntryBoardItem[],
  area: AreaId,
  todayStr: string,
): EntryBoardItem[] {
  return items.slice().sort((a, b) => {
    const ka = sortKeyOf(a, area, todayStr)
    const kb = sortKeyOf(b, area, todayStr)
    if (ka == null && kb == null) return cmp(a.eventDate, b.eventDate)
    if (ka == null) return 1
    if (kb == null) return -1
    const byKey = cmp(ka, kb)
    return byKey !== 0 ? byKey : cmp(a.eventDate, b.eventDate)
  })
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 畳んでいても隠さない行かどうか。
 *
 * 「締切前」は会内締切が {@link SOON_THRESHOLD} 日以内に迫った大会だけ、
 * 折りたたみ状態に関わらず出し続ける。畳んだまま締切を跨ぐ事故を防ぐため。
 * 締切未設定（判定不能）の行は対象外＝畳めば隠れる。
 */
export function isPinnedWhenCollapsed(
  item: EntryBoardItem,
  area: AreaId,
  todayStr: string,
): boolean {
  if (area !== 'before_deadline') return false
  const base = baseDeadlineOf(item)
  if (base == null) return false
  const daysLeft = daysBetween(todayStr, base)
  return daysLeft != null && daysLeft <= SOON_THRESHOLD
}

/**
 * その大会の締切が「本日以降」＝当日を迎えたか、既に過ぎているか。
 * 行動フェーズ（要対応・名簿確定・振込待ち）にこれが 1 件でもあるとき、
 * 区画全体を強調する。まだ数日先しかない間は強調しないので、
 * 赤い表示に慣れて効かなくなることがない。
 */
export function isDue(
  item: EntryBoardItem,
  area: AreaId,
  todayStr: string,
): boolean {
  const tone = deadlineBadgeOf(item, area, todayStr).tone
  // 'none' = その区画で見る日付が未設定。行動フェーズで日付が分からない大会は
  // 「安全」と言い切れないので到来済み扱いにする（fail-safe）。特に「要対応」は
  // 会内締切を過ぎて参加希望者もいる大会の集まりなので、本締切が未入力という
  // 理由で強調が外れるのが一番危ない。
  return tone === 'today' || tone === 'past' || tone === 'none'
}

/** 区画を強調表示するか（行動フェーズ かつ 締切到来済みが 1 件以上）。 */
export function isAreaHot(
  area: AreaDef,
  items: EntryBoardItem[],
  todayStr: string,
): boolean {
  if (!area.actionable) return false
  return items.some((i) => isDue(i, area.id, todayStr))
}

/**
 * 描画する区画だけを持つ。非表示に落ちた大会はどのキーにも入らないので、
 * 全キーの合計 = ボードに実際に並ぶ件数になる（空状態の判定に使える）。
 */
export type GroupedBoard = Record<VisibleAreaId, EntryBoardItem[]>

/** 全件をエリアへ振り分け、各エリア内を並べ替える。 */
export function groupBoard(
  items: EntryBoardItem[],
  todayStr: string,
): GroupedBoard {
  const out = {} as GroupedBoard
  for (const area of AREAS) out[area.id] = []
  for (const item of items) {
    const area = classify(item, todayStr)
    if (isHiddenArea(area)) continue
    out[area].push(item)
  }
  for (const area of AREAS) {
    out[area.id] = sortArea(out[area.id], area.id, todayStr)
  }
  return out
}

// ---------------------------------------------------------------------------
// 表示ヘルパー
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function toEpochDay(dateStr: string): number | null {
  const ms = Date.parse(`${dateStr}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/** `YYYY-MM-DD` → `M/D`（締切など、曜日が不要な箇所）。 */
export function formatShortDate(dateStr: string): string {
  const m = DATE_RE.exec(dateStr)
  if (!m) return dateStr
  return `${Number(m[2])}/${Number(m[3])}`
}

export function daysBetween(fromStr: string, toStr: string): number | null {
  const from = toEpochDay(fromStr)
  const to = toEpochDay(toStr)
  if (from == null || to == null) return null
  return Math.round((to - from) / 86_400_000)
}

/** 締切バッジの緊急度。`event-list-utils.DeadlineTone` と同じ語彙。 */
export type DeadlineTone = 'today' | 'soon' | 'normal' | 'past' | 'none'

export const SOON_THRESHOLD = 3

export interface DeadlineBadge {
  /** 「会内締切」「支払締切」など、そのエリアで見ている締切の名前。 */
  label: string
  /** 「4/22」など。締切が無い場合は null。 */
  date: string | null
  /** 「3日超過」「あと5日」「本日」「締切未設定」など。 */
  countdown: string
  tone: DeadlineTone
}

/**
 * エリアごとに「いま見たい締切」を切り替えて 1 つのバッジへ畳む（要件 §3.2.3）。
 */
export function deadlineBadgeOf(
  item: EntryBoardItem,
  area: AreaId,
  todayStr: string,
): DeadlineBadge {
  switch (area) {
    case 'action_required':
      return build('本締切', item.entryDeadline, todayStr, '締切未設定')
    case 'applied_waiting':
      return build('抽選日', item.lotteryDate, todayStr, '未定')
    case 'payment_due':
      return build('支払締切', item.paymentDeadline, todayStr, '締切未設定')
    case 'done':
      return build('開催日', item.eventDate, todayStr)
    default:
      return build('会内締切', baseDeadlineOf(item), todayStr, '締切未設定')
  }
}

function build(
  label: string,
  date: string | null,
  todayStr: string,
  nullText = '未設定',
): DeadlineBadge {
  if (date == null) {
    return { label, date: null, countdown: nullText, tone: 'none' }
  }
  const diff = daysBetween(todayStr, date)
  if (diff == null) {
    return { label, date: null, countdown: nullText, tone: 'none' }
  }
  const shownDate = formatShortDate(date)
  if (diff < 0) {
    return { label, date: shownDate, countdown: `${-diff}日超過`, tone: 'past' }
  }
  if (diff === 0) {
    return { label, date: shownDate, countdown: '本日', tone: 'today' }
  }
  return {
    label,
    date: shownDate,
    countdown: `あと${diff}日`,
    tone: diff <= SOON_THRESHOLD ? 'soon' : 'normal',
  }
}
