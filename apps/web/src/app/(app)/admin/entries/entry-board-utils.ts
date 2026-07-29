import type { Grade } from '@kagetra/shared/types'
// 進行状態 3 型の正典は LifecycleStatusBadge.tsx（要件 §6 技術的制約）。
// ここで union を再定義すると状態が増えたときに 2 箇所がずれるので参照する。
// type-only import なのでコンポーネント本体は実行時に引きずり込まれない。
import type {
  EntryStatus,
  PaymentStatus,
  PaymentType,
} from '@/components/events/LifecycleStatusBadge'
// mail-ai-extract-refinements §3.2.7: 振込締切の状態。type-only import なので
// `@/lib/entry-groups` の DB 依存漏れ注意（上のコメント）とは事情が違う——
// `@/lib/events/payment-deadline` 自体が純関数のみで値 import を持たない。
import type { PaymentDeadlineKind } from '@/lib/events/payment-deadline'

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
 * `EntryBoardItem.groupDisplayName` / `groupName` / `groupRepresentativeEventId`
 * として平らな値で渡す。`groupBoard` はそれを読むだけ（計算しない）。
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
   * 行に実際に出すグループ表示名（要件 §3.2.5。2026-07-28 新設）。
   *
   * `groupName` と違い**通称ベース**で畳んだ名前（例「杉並B」+「杉並A」→「杉並AB」）。
   * 1 グループ = 1 行になったことで、素朴に `groupName`（`events.title` 由来＝正式
   * 名称）を出すと単独イベントの表示が通称から正式名称へ退行するため、page.tsx が
   * 「各日の {@link displayName} を作ってから畳む」順序で導出して全行にコピーする。
   * 畳めなかったときだけ `groupName` へフォールバックするので、この値は常に非 null。
   */
  groupDisplayName: string
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
  /**
   * 振込締切の状態（AC-42）。`paymentDeadline` が null のとき、`later_notice` なら
   * 「後日連絡」、`unspecified` なら従来どおり「締切未設定」と出し分ける
   * （{@link deadlineBadgeOf} 参照）。
   */
  paymentDeadlineKind: PaymentDeadlineKind
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
 * 締切前 → 要申込 → 申込完了・抽選待ち → 名簿確定・要振込 → 完了。
 * 緊急度順ではなく進行順に固定することで、「どの大会がどのフェーズにいるか」を
 * 上から下へ読み下せるようにする。
 *
 * ★label は 2026-07-28 に 3 件改称した（要件 §3.2.3 / 設計判断17）。旧名は緊急度
 * しか伝えず「何をすべきか」が読めなかったため、その区画で管理者が取る**行動**
 * （申込・振込）を名前に入れた。旧名との対応表は requirements.md §3.2.3 の注記が
 * 持つ。**`id`（{@link AreaId}）は変えていない** — 変えると entry-overdue-alert
 * との対応関係と既存テストの参照が無駄に壊れる。判定条件・表示する日付・並び順
 * キーもすべて不変（純粋な改称）。
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
    label: '要申込',
    // 会内締切は既に過ぎている区画なので、見るべきは主催者への申込締切
    // （＝本締切）。ここを落とすと申込漏れが確定する。
    deadlineHint: '本締切',
    actionable: true,
  },
  {
    id: 'applied_waiting',
    label: '申込完了・抽選待ち',
    deadlineHint: '抽選日',
    actionable: false,
    showCountdown: false,
  },
  {
    id: 'payment_due',
    label: '名簿確定・要振込',
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

/** {@link displayName} が必要とする最小の形（DTO 組み立て前の生の行でも渡せる）。 */
export interface NameSource {
  title: string
  shortName: string | null
  eligibleGrades: Grade[] | null
}

/**
 * 1 日ぶんの表示名 = 通称 + 級（例「札幌AB」）。正式名称は使わない。
 * 通称が引けない大会（edition 未紐付け）は title にフォールバックするが、
 * title は運用上すでに級込みの命名（「多摩A」等。メール承認の unit 分割が
 * 級込みの名前で events を作る）なので、級は連結せずそのまま出す（Issue #335）。
 *
 * 1 グループ = 1 行になった後（2026-07-28）は、**page.tsx がグループ表示名を導出
 * する際の第1段**としてこの関数を使う（要件 §3.2.5 の手順1）。ボードが直接
 * 呼ぶのではなく、導出済みの {@link EntryBoardItem.groupDisplayName} を描く。
 * 単独イベントのグループでは畳む対象が1件なので、この関数の結果がそのまま
 * 表示名になる＝改修前と1文字も変わらない（AC-16b の回帰はこの構造で保証する）。
 *
 * ホーム `/dashboard`（会の出場予定）も同じ表示名規約なので {@link NameSource} を
 * 満たす行をそのまま渡して再利用する。表示名の導出はここが唯一の実装。
 */
export function displayName(item: NameSource): string {
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
  // 会としてはやることが無い大会が「申込完了・抽選待ち」に滞留していた。
  // 戻す条件: 確定名簿なしで完了へ入った大会に、実は会としてやることが残って
  // いたケースが実運用で出たとき。判定を反転させず**評価順**で表現してあるので、
  // 戻すときは `git revert` で下 3 行の順序が戻るだけで済む。
  if (item.paymentType !== 'advance' || item.paymentStatus === 'paid') return 'done'
  // ここから先は事前払いかつ未振込のみ。名簿の有無で待ちの種類が分かれる。
  if (!item.hasConfirmedRoster) return 'applied_waiting'
  return 'payment_due'
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
 * 行動フェーズ（要申込・名簿確定・要振込）にこれが 1 件でもあるとき、
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
  // 「安全」と言い切れないので到来済み扱いにする（fail-safe）。特に「要申込」は
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
 * ボードの1行に相当する「申込グループ」。
 *
 * 要件 §3.2.5: `/admin/entries` は **1 グループ = 常に 1 行**で表示する
 * （2026-07-28。日別行への展開は廃止した＝設計判断18）。行が載る区画・並び順・
 * 表示する日付と人数の集約はすべてこの型を介して {@link groupBoard} と
 * {@link pickRepresentativeDay} / {@link groupAttendCount} が計算する。
 * 実際の描画は EntryBoardClient.tsx が持つ。
 */
export interface EntryBoardGroup {
  groupId: number
  /** 行に出す表示名。`EntryBoardItem.groupDisplayName`（通称ベース）を転記したもの。 */
  name: string
  /** 行タップの遷移先。`EntryBoardItem.groupRepresentativeEventId`（設計判断4）。 */
  representativeEventId: number
  /** 行が載る区画（{@link pickGroupArea} 参照）。 */
  area: VisibleAreaId
  /**
   * 集約の母集団になる可視日。非表示区画（`no_applicants`）に分類された日は
   * 含まない（そのグループのメンバーであっても個別の「申し込まない」大会は
   * ボードに出さない、という単一イベント時の既存挙動を維持する）。
   * **画面には行として出ない** — 日付・人数・並び順を導くためだけに持つ。
   * 開催日昇順・同日は id 昇順。
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
 * グループは「最も対応が必要な区画」1つにだけ載る（設計判断2 / §3.2.5.2）。
 * 1 行化した後もこの優先順位は必要 — 日ごとに状態が違っても行は1つなので、
 * どこに置くかを決めなければならない。見落とし方向には倒れない（安全側）。
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
 * 設計判断4/5（グループ名・代表イベント）: `groupDisplayName` / `groupRepresentativeEventId`
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
      name: anyMember.groupDisplayName,
      representativeEventId: anyMember.groupRepresentativeEventId,
      area,
      days: visibleDays,
    })
  }

  for (const group of groups) out[group.area].push(group)
  for (const area of AREAS) {
    out[area.id] = sortGroupsInArea(out[area.id], todayStr)
  }
  return out
}

/**
 * 行の並び順キー = 区画（`group.area`）の観点で見た締切/抽選日のうち、可視日の
 * 中で最も早いもの（null は無視。全日 null ならキー無し＝末尾）。
 * 「最も差し迫っている日」でグループ全体の緊急度を代表させる。
 *
 * ★{@link pickRepresentativeDay} 経由に統一してある（2026-07-28）。並び順と
 * 画面に出る日付を同じ日から出すため（AC-37）。ここで独立に最小値を計算しない。
 */
function groupSortKey(group: EntryBoardGroup, todayStr: string): string | null {
  return sortKeyOf(pickRepresentativeDay(group, todayStr), group.area, todayStr)
}

function minEventDate(group: EntryBoardGroup): string {
  return group.days.reduce(
    (min, d) => (d.eventDate < min ? d.eventDate : min),
    group.days[0]!.eventDate,
  )
}

/**
 * 昇順・null 末尾・（可視日のうち最も早い）開催日を副キー（非破壊）。
 *
 * 副キーは **`minEventDate`（可視日全体の最小開催日）のまま**にしてある。
 * 代表日の開催日へ寄せると、キー同値のときの並びが「最も早い開催日」ではなく
 * 「最も早い締切の日の開催日」に変わってしまい、AC-15 / AC-31c（並び順の回帰）
 * が静かに壊れる。
 */
function sortGroupsInArea(
  groups: EntryBoardGroup[],
  todayStr: string,
): EntryBoardGroup[] {
  return groups.slice().sort((a, b) => {
    const ka = groupSortKey(a, todayStr)
    const kb = groupSortKey(b, todayStr)
    if (ka == null && kb == null) return cmp(minEventDate(a), minEventDate(b))
    if (ka == null) return 1
    if (kb == null) return -1
    const byKey = cmp(ka, kb)
    return byKey !== 0 ? byKey : cmp(minEventDate(a), minEventDate(b))
  })
}

/**
 * グループの日付・残日数を代表する 1 日を選ぶ（要件 §3.2.5.1）。
 *
 * 選定規則 = **その区画で見る日付（{@link sortKeyOf}）が最も早い可視日**。
 * NULL は末尾（＝全日 NULL のときだけ NULL の日が選ばれる）、同値は開催日 → id
 * で安定化する。
 *
 * ★{@link groupSortKey}（並び順）と {@link groupDeadlineBadge}（表示）は
 * **どちらもこの関数を通す**。並び順キーと画面に出る日付が構造的に同じ日から
 * 出ることを保証するためで、これが AC-37 の肝（別々に最小値を取ると、実装が
 * 少しずれた瞬間に「並びと表示が食い違うボード」になる）。
 */
export function pickRepresentativeDay(
  group: EntryBoardGroup,
  todayStr: string,
): EntryBoardItem {
  const first = group.days[0]
  if (!first) {
    // groupBoard は可視日 0 件のグループを作らない契約。呼び出しのバグを黙って
    // 通さないよう fail-fast にする（reduce の TypeError より原因が分かる）。
    throw new Error('assertion failed: グループの可視日が空です')
  }
  return group.days.reduce((best, day) => {
    const kBest = sortKeyOf(best, group.area, todayStr)
    const kDay = sortKeyOf(day, group.area, todayStr)
    if (kDay == null && kBest == null) return stabler(best, day)
    if (kDay == null) return best
    if (kBest == null) return day
    if (kDay !== kBest) return kDay < kBest ? day : best
    return stabler(best, day)
  }, first)
}

/** キーが同値（または両方 NULL）のときの決定的なタイブレーク: 開催日 → id。 */
function stabler(best: EntryBoardItem, day: EntryBoardItem): EntryBoardItem {
  if (day.eventDate !== best.eventDate) {
    return day.eventDate < best.eventDate ? day : best
  }
  return day.id < best.id ? day : best
}

/**
 * グループの行に出す締切/抽選日バッジ（要件 §3.2.5.1）。
 * {@link pickRepresentativeDay} が選んだ日の {@link deadlineBadgeOf}。
 *
 * **受容する情報欠落:** グループ内で締切が食い違う場合、最も早い日以外の締切は
 * この画面から見えない（設計判断18 / §3.2.5.1。内訳は行タップで大会詳細へ）。
 */
export function groupDeadlineBadge(
  group: EntryBoardGroup,
  todayStr: string,
): DeadlineBadge {
  return deadlineBadgeOf(pickRepresentativeDay(group, todayStr), group.area, todayStr)
}

/**
 * グループの参加希望者数 = **可視日の合計**（要件 §3.2.5.1 / AC-38）。
 * 非表示条件で落ちた日は `group.days` に含まれないので自然に除かれる。
 * 「人が集まっているグループ」を探せることが目的なので、最大値や代表日の値では
 * 過少表示になる。
 */
export function groupAttendCount(group: EntryBoardGroup): number {
  return group.days.reduce((sum, day) => sum + day.attendCount, 0)
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
      return paymentDeadlineBadge(item, todayStr)
    case 'done':
      return build('開催日', item.eventDate, todayStr)
    default:
      return build('会内締切', baseDeadlineOf(item), todayStr, '締切未設定')
  }
}

/**
 * 「名簿確定・要振込」区画の締切バッジ（AC-42）。`payment_deadline` が null のとき、
 * `later_notice`（案内に「後日連絡」と明記されていた）なら期限超過扱いにしない
 * ——締切が決まっていないのだから遅延ではない。`unspecified`（読み取れなかった等）
 * は従来どおり「締切未設定」（tone: 'none'。{@link isDue} は fail-safe で到来済み扱い）。
 */
function paymentDeadlineBadge(item: EntryBoardItem, todayStr: string): DeadlineBadge {
  if (item.paymentDeadline == null && item.paymentDeadlineKind === 'later_notice') {
    return { label: '支払締切', date: null, countdown: '後日連絡', tone: 'normal' }
  }
  return build('支払締切', item.paymentDeadline, todayStr, '締切未設定')
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
