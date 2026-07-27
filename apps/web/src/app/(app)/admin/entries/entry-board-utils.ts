import type { Grade } from '@kagetra/shared/types'
// 進行状態 3 型の正典は LifecycleStatusBadge.tsx（要件 §6 技術的制約）。
// ここで union を再定義すると状態が増えたときに 2 箇所がずれるので参照する。
// type-only import なのでコンポーネント本体は実行時に引きずり込まれない。
import type {
  EntryStatus,
  PaymentStatus,
  PaymentType,
} from '@/components/events/LifecycleStatusBadge'

/**
 * entry-groups タスク6: 表示名導出・代表イベント選定は `@/lib/entry-groups` の
 * `deriveEntryGroupName` / `selectRepresentativeEvent` が唯一の実装
 * （呼び出し側で再実装しない。requirements タスク6 依存タスク2）。
 *
 * ただし **このファイルからは lib を import しない**。`entry-board-utils.ts` は
 * `EntryBoardClient.tsx`（`'use client'`）から import される唯一の非コンポーネント
 * モジュールで、`@/lib/entry-groups` は `@kagetra/shared/schema` と `drizzle-orm`
 * を値 import している（DB 層）。ここで import すると初めて client バンドルへ
 * DB 依存が漏れる（eslint / vitest / check-types は検知できず `next build` で
 * 初めて壊れる）。そのため page.tsx（サーバー）が group ごとに一度だけ
 * `deriveEntryGroupName` / `selectRepresentativeEvent` を呼び、結果を
 * `EntryBoardItem.groupName` / `groupRepresentativeEventId` として
 * 平らな値で渡す。`groupBoard` はそれを読むだけ（計算しない）。
 */

/**
 * 申込管理ボード（`/admin/entries`）の仕分け・並び順・締切表示の純関数。
 *
 * `Date.now()` を呼ばない。サーバーが JST の `todayStr` を渡し、クライアントは
 * それを使って同じ結果を描く（hydration mismatch を避ける。`event-list-utils.ts`
 * と同じ方針）。要件: docs/features/entry-management/requirements.md §3.2
 */

export type { EntryStatus, PaymentStatus, PaymentType }

/** エリア識別子（要件 §3.2.3）。 */
export type AreaId =
  | 'action_required'
  | 'payment_due'
  /**
   * 申込済で**事前払い（`advance`）かつ未振込**、かつ確定名簿がまだ出ていない。
   * 抽選待ちもここに含む。支払いの決着（振込済／現地払い／支払い管理なし）が
   * 付いた大会は名簿の有無に関わらずここへは来ない（{@link classify} 参照）。
   */
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
  /** `events.entry_group_id`。タスク6: カード集約のキー。 */
  entryGroupId: number
  /**
   * タスク6: グループ表示名（`deriveEntryGroupName` の結果。null なら代表イベントの
   * タイトルへフォールバック済み）。**page.tsx がグループごとに一度だけ計算し、
   * 同じグループの全行に同じ値をコピーする**（このファイルは lib を import しない
   * ——上の import コメント参照）。同一グループ内では常に同じ値になる。
   */
  groupName: string
  /**
   * タスク6: グループの代表イベント id（`selectRepresentativeEvent` の結果）。
   * `groupName` と同様、page.tsx がグループごとに一度だけ計算する。
   */
  groupRepresentativeEventId: number
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
  /** null = 支払い通知なし（既存スキーマの意味。events.ts 参照）。 */
  paymentType: PaymentType | null
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
 * 通称が引けない大会（edition 未紐付け）は title にフォールバックするが、
 * title は運用上すでに級込みの命名（「多摩A」等。メール承認の unit 分割が
 * 級込みの名前で events を作る）なので、級は連結せずそのまま出す（Issue #335）。
 */
export function displayName(item: EntryBoardItem): string {
  if (item.shortName == null) return item.title
  const grades = item.eligibleGrades?.join('') ?? ''
  return `${item.shortName}${grades}`
}

/** 基準締切 = 会内締切、未入力なら大会申込締切で代替（要件 §3.2.2）。 */
export function baseDeadlineOf(item: EntryBoardItem): string | null {
  return item.internalDeadline ?? item.entryDeadline
}

/**
 * 大会をちょうど 1 つのエリアへ振り分ける（要件 §3.2.3）。
 * 各 `return` は先に一致したものが勝つ（`applied` 分岐だけは評価順に意味がある
 * ——下のコメント参照）。
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
  // 支払いの決着（振込済／現地払い／支払い管理なし）が付いた大会は確定名簿を
  // 待たない（2026-07-27）。確定名簿は「主催者が発表する」「こちらが取り込む」の
  // 両方が揃って初めて true になる外部依存の値なので、名簿が来ていないだけで
  // 会としてはやることが無い大会が「申込済み・抽選待ち」に滞留していた。
  // 戻す条件: 確定名簿なしで完了へ入った大会に、実は会としてやることが残って
  // いたケースが実運用で出たとき。判定を反転させず**評価順**で表現してあるので、
  // 戻すときは `git revert` で下 3 行の順序が戻るだけで済む。
  if (item.paymentType !== 'advance' || item.paymentStatus === 'paid') return 'done'
  // ここから先は事前払いかつ未振込のみ。名簿の有無で待ちの種類が分かれる。
  if (!item.hasConfirmedRoster) return 'applied_waiting'
  return 'payment_due'
}

/**
 * 日別行に出す「その日自身の」進行状態ラベル（AC-14: 日別の進行状態）。
 *
 * カード全体が載る区画（{@link EntryBoardGroup.area}）は「グループ内で最も
 * 対応が必要な区画」に寄せた1つの値だが、日別行はそれとは独立に**その日自身の
 * `classify` 結果**をラベルとして出す——そうしないと、カードが `action_required`
 * に居るせいで実は `done` の日まで「対応が必要」に見えてしまう（設計判断2の
 * 前提を裏切らないための描画側の担保）。
 *
 * `classify` が `no_applicants`（非表示）を返すことは想定しない
 * （呼び出し側は非表示日をあらかじめ除いた `EntryBoardGroup.days` にしか
 * 使わない契約）。万一渡された場合は空文字を返す。
 */
export function dayStatusLabel(item: EntryBoardItem, todayStr: string): string {
  const area = classify(item, todayStr)
  return AREAS.find((a) => a.id === area)?.label ?? ''
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
 * ボードの1カードに相当する「申込グループ」。
 *
 * タスク6（要件 §3.1, AC-14/AC-15）: `/admin/entries` は 1 グループ = 1 カード
 * で表示する。カードが載る区画・共通の締切/抽選日の出し分け・並び順はすべて
 * この型を介して {@link groupBoard} が計算する。実際の描画（カード内の
 * ヘッダーと日別行の組み立て）は EntryBoardClient.tsx が持つ。
 */
export interface EntryBoardGroup {
  groupId: number
  /** `EntryBoardItem.groupName`（設計判断5）をそのまま転記したもの。 */
  name: string
  /** カードタップの遷移先。`EntryBoardItem.groupRepresentativeEventId`（設計判断4）。 */
  representativeEventId: number
  /** カードが載る区画（{@link pickGroupArea} 参照）。 */
  area: VisibleAreaId
  /**
   * 日別行。非表示区画（`no_applicants`）に分類された日は含まない
   * （そのグループのメンバーであっても個別の「申し込まない」大会はボードに出さない、
   * という単一イベント時の既存挙動を維持する）。開催日昇順・同日は id 昇順。
   */
  days: EntryBoardItem[]
}

/**
 * グループ内で日別 classify が食い違うとき、カード全体をどの区画に置くかの
 * 優先順位（設計判断2）。上ほど「対応が必要」＝管理者が見落とすと実害が出る:
 *
 * - `action_required`: 会内締切を過ぎてまだ本申込していない。放置すると申込漏れが確定する
 * - `payment_due`: 名簿確定済みで振込がまだ。放置すると入金遅延になる
 * - `applied_waiting`: 抽選待ち等。行動は不要だが進行を追う必要がある
 * - `before_deadline`: まだ締切前
 * - `done`: 完了
 *
 * `no_applicants` は非表示区画なので候補にならない（呼び出し側で先に除外する）。
 * カードは「最も対応が必要な区画」1つにだけ載り、そこに全ての非表示日が
 * 日別行として並ぶ（設計判断2）。
 */
const GROUP_AREA_PRIORITY: readonly VisibleAreaId[] = [
  'action_required',
  'payment_due',
  'applied_waiting',
  'before_deadline',
  'done',
]

/** `dayAreas`（非表示を除いた各日の classify 結果）からカードの区画を1つ選ぶ。 */
function pickGroupArea(dayAreas: readonly AreaId[]): VisibleAreaId {
  for (const area of GROUP_AREA_PRIORITY) {
    if (dayAreas.includes(area)) return area
  }
  // 呼び出し側が非表示日を除いてから渡す契約なので、ここに来るのは呼び出しの
  // バグ（空配列を渡した等）。fail-fast で気付けるようにする。
  throw new Error('assertion failed: グループの区画候補が空です（非表示日しか無い）')
}

/**
 * 描画する区画だけを持つ。非表示に落ちたグループはどのキーにも入らないので、
 * 全キーの合計件数 = ボードに実際に並ぶカード数になる（空状態の判定に使える）。
 */
export type GroupedBoard = Record<VisibleAreaId, EntryBoardGroup[]>

/**
 * 全件を申込グループへ集約し、各カードを1区画へ振り分けて、各区画内を並べ替える。
 *
 * 母集団クエリの条件（§3.2.1）は変えない。ここでの集約は「同じ entryGroupId を
 * 1枚のカードにまとめる」だけで、どのイベントが母集団に載るかには関与しない。
 *
 * 設計判断4/5（グループ名・代表イベント）: `groupName` / `groupRepresentativeEventId`
 * は**グループの全メンバー**（可視・非表示を問わない）から page.tsx が一度だけ
 * 計算した値なので、ここではメンバーの誰か1件（`members[0]`）から読めば十分
 * ——同じグループなら誰から読んでも同じ値になる。したがって、グループの中で
 * 今日以降に最も近い日が「申し込まない」で非表示になっていても、カードの
 * 遷移先はその日を指しうる（そのグループの代表イベントという概念自体が
 * ボードの表示可否と独立しているため。意図的な選択——グループ名・代表は
 * 「ボードに見えている行」ではなく「グループというまとまり」のプロパティ）。
 */
export function groupBoard(
  items: EntryBoardItem[],
  todayStr: string,
): GroupedBoard {
  const out = {} as GroupedBoard
  for (const area of AREAS) out[area.id] = []

  const membersByGroup = new Map<number, EntryBoardItem[]>()
  for (const item of items) {
    const arr = membersByGroup.get(item.entryGroupId)
    if (arr) arr.push(item)
    else membersByGroup.set(item.entryGroupId, [item])
  }

  const groups: EntryBoardGroup[] = []
  for (const [groupId, members] of membersByGroup) {
    const visibleDays = members
      .filter((m) => !isHiddenArea(classify(m, todayStr)))
      .slice()
      .sort((a, b) => cmp(a.eventDate, b.eventDate) || a.id - b.id)
    if (visibleDays.length === 0) continue // グループ全体が非表示（全日 no_applicants）

    const area = pickGroupArea(visibleDays.map((d) => classify(d, todayStr)))
    const anyMember = members[0]!

    groups.push({
      groupId,
      name: anyMember.groupName,
      representativeEventId: anyMember.groupRepresentativeEventId,
      area,
      days: visibleDays,
    })
  }

  for (const group of groups) out[group.area].push(group)
  for (const area of AREAS) {
    out[area.id] = sortGroupsInArea(out[area.id], area.id, todayStr)
  }
  return out
}

/**
 * カードの並び順キー = カードの区画（`area`）の観点で見た締切/抽選日のうち、
 * 日別行の中で最も早いもの（null は無視。全日 null ならキー無し＝末尾）。
 * 「最も差し迫っている日」でカード全体の緊急度を代表させる。
 */
function groupSortKey(
  group: EntryBoardGroup,
  area: VisibleAreaId,
  todayStr: string,
): string | null {
  let best: string | null = null
  for (const day of group.days) {
    const key = sortKeyOf(day, area, todayStr)
    if (key == null) continue
    if (best == null || key < best) best = key
  }
  return best
}

function minEventDate(group: EntryBoardGroup): string {
  return group.days.reduce(
    (min, d) => (d.eventDate < min ? d.eventDate : min),
    group.days[0]!.eventDate,
  )
}

/** 昇順・null 末尾・（日別行のうち最も早い）開催日を副キー（非破壊）。 */
function sortGroupsInArea(
  groups: EntryBoardGroup[],
  area: VisibleAreaId,
  todayStr: string,
): EntryBoardGroup[] {
  return groups.slice().sort((a, b) => {
    const ka = groupSortKey(a, area, todayStr)
    const kb = groupSortKey(b, area, todayStr)
    if (ka == null && kb == null) return cmp(minEventDate(a), minEventDate(b))
    if (ka == null) return 1
    if (kb == null) return -1
    const byKey = cmp(ka, kb)
    return byKey !== 0 ? byKey : cmp(minEventDate(a), minEventDate(b))
  })
}

/**
 * カード共通の締切/抽選日バッジ（設計判断3）。
 *
 * カードの区画（`group.area`）の観点で見た締切/抽選日（`deadlineBadgeOf` と
 * 同じ、区画ごとに固定の1フィールド）が全日別行で同一なら、そのバッジを返す
 * （カードヘッダーに1回だけ表示する）。1件でも異なれば `null` を返し、
 * 呼び出し側は共通表示をやめて日別行それぞれに `deadlineBadgeOf` を出す。
 *
 * シングルトン（`days.length === 1`）は比較対象が1件しかないので必ず非 null
 * になる——単一イベント時の「1回だけ表示」する既存の見え方と同じ結果になる。
 */
export function commonDeadlineBadge(
  group: EntryBoardGroup,
  todayStr: string,
): DeadlineBadge | null {
  const badges = group.days.map((d) => deadlineBadgeOf(d, group.area, todayStr))
  const first = badges[0]
  if (!first) return null
  const allSame = badges.every(
    (b) => b.date === first.date && b.countdown === first.countdown && b.tone === first.tone,
  )
  return allSame ? first : null
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
