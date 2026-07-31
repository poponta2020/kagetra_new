import { and, asc, eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  entryGroups,
  eventLineBroadcasts,
  events,
  lineChannels,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import type { EventStatus } from '@kagetra/shared/types'
import type { PaymentDeadlineKind } from './events/payment-deadline'
import { diffDays } from './jst-date'
// クラスタ規則の純関数は DB 非依存の leaf モジュールが持つ（client からも import
// できるように分離してある）。サーバー側の既存 import 経路を壊さないよう再 export する。
export { clusterEventsByEntryGroup, type ClusterableEvent } from './entry-group-cluster'

type DbLike = NodePgDatabase<typeof schema>

/**
 * entry-groups: 申込グループのコア。
 *
 * グループ = 「同じ案内メール × 同じ申込締切で運用されるまとまり」。これは
 * **デフォルトの生成規則であって制約ではない**（管理者は後から自由に付け替えできる）。
 * requirements §3.2.1 / §3.2.10。
 */

/** 新しい申込グループを1件作って id を返す。 */
export async function createEntryGroup(tx: DbLike): Promise<number> {
  const [row] = await tx.insert(entryGroups).values({}).returning({ id: entryGroups.id })
  if (!row) throw new Error('entry_groups の作成に失敗しました')
  return row.id
}

/**
 * entry-groups タスク3: `eventId` から所属グループの id を引く。
 *
 * LINE 紐付け・配信は帰属を entry_group へ移したが、呼び出し側（詳細画面）は
 * 「その日」の event id しか持たない。公開関数のシグネチャは eventId のまま
 * 維持し、内部でこの関数を通してグループへ解決する（requirements タスク3
 * 設計判断1）。イベントが存在しなければ例外を投げる。
 */
export async function resolveEntryGroupId(dbc: DbLike, eventId: number): Promise<number> {
  const [row] = await dbc
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  if (!row) throw new Error('大会が見つかりません')
  return row.entryGroupId
}

// ---------------------------------------------------------------------------
// タスク2: 表示名導出・代表イベント選定・グループ一覧・付け替え・伝播
// ---------------------------------------------------------------------------

const GRADE_LETTERS = new Set(['A', 'B', 'C', 'D', 'E'])

/** `strings` 全ての先頭から一致する最長の共通接頭辞。空配列は空文字。 */
function commonPrefix(strings: readonly string[]): string {
  if (strings.length === 0) return ''
  let prefix = strings[0]!
  for (const s of strings.slice(1)) {
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
    if (prefix.length === 0) break
  }
  return prefix
}

/**
 * グループ表示名を導出する（**保存しない・呼び出しの都度計算**）。純関数（requirements §3.2.1）。
 *
 * 規則:
 * - 1件だけ → そのタイトル
 * - 全タイトルが同一 → そのタイトル（例: 大学生選手権×3 → `大学生選手権`）
 * - 共通接頭辞があり、各タイトルの残りが1文字の級文字（A〜E）のみ →
 *   `共通接頭辞 + 級文字を昇順連結`（例: `多摩A` + `多摩B` → `多摩AB`）
 * - それ以外（導出不能）→ `null`。**呼び出し側が代表イベントのタイトルへフォールバックする**
 *   （DB から独立させるため、フォールバック先の決定は呼び出し側の責務）
 */
export function deriveEntryGroupName(titles: readonly string[]): string | null {
  if (titles.length === 0) return null
  if (titles.length === 1) return titles[0]!
  if (titles.every((t) => t === titles[0])) return titles[0]!

  const prefix = commonPrefix(titles)
  if (prefix.length === 0) return null

  const suffixes = titles.map((t) => t.slice(prefix.length))
  if (!suffixes.every((s) => s.length === 1 && GRADE_LETTERS.has(s))) return null

  const uniqueGrades = Array.from(new Set(suffixes)).sort()
  return `${prefix}${uniqueGrades.join('')}`
}

/** 代表イベント選定に必要な最小のイベント形。 */
export interface RepresentativeCandidate {
  id: number
  /** `YYYY-MM-DD`。 */
  eventDate: string
}

/**
 * グループ内イベントから「代表イベント」を選ぶ（requirements §3.1）。純関数——`Date.now()` を
 * 直接読まず、呼び出し側が `todayInJst()`（`lib/jst-date.ts`）で注入した `todayStr` を使う
 * （テスト容易性）。
 *
 * 規則: `eventDate >= todayStr` のうち最小、無ければ全体の最大。同着は id 昇順で安定させる。
 * cancelled も候補に含める（エラーケース: 代表選定からは除外しない。詳細画面は到達可能）。
 */
export function selectRepresentativeEvent<T extends RepresentativeCandidate>(
  events: readonly T[],
  todayStr: string,
): T | null {
  if (events.length === 0) return null

  const future = events.filter((e) => e.eventDate >= todayStr)
  const pool = future.length > 0 ? future : events
  const pickMin = future.length > 0

  return pool.reduce((best, e) => {
    if (pickMin) {
      if (e.eventDate < best.eventDate) return e
      if (e.eventDate === best.eventDate && e.id < best.id) return e
      return best
    }
    if (e.eventDate > best.eventDate) return e
    if (e.eventDate === best.eventDate && e.id < best.id) return e
    return best
  })
}

/** `listGroupSiblings` が返す最小限の列（RSC payload を太らせない）。 */
export interface GroupSiblingEvent {
  id: number
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
  eligibleGrades: string[] | null
  status: EventStatus
}

/**
 * `eventId` が属するグループの全イベントを開催日昇順（自分自身を含む）で返す。
 * 対象イベントが存在しなければ空配列。
 */
export async function listGroupSiblings(
  db: DbLike,
  eventId: number,
): Promise<GroupSiblingEvent[]> {
  const [target] = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  if (!target) return []

  return db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      eligibleGrades: events.eligibleGrades,
      status: events.status,
    })
    .from(events)
    .where(eq(events.entryGroupId, target.entryGroupId))
    .orderBy(asc(events.eventDate), asc(events.id))
}

/**
 * 空になったグループを条件付きで削除する（requirements §3.2.6）。
 *
 * **この関数が entry_groups 削除の唯一の経路**であり、削除条件はここに集約する。
 * 判定するのは **4表すべてが0件**であること:
 * `events` / `event_line_broadcasts` / `tournament_entry_rosters` /
 * `line_channels.assigned_entry_group_id`。
 *
 * ★events だけを見てはならない（r1 review blocker）。タスク3/8 で LINE 紐付けと名簿の
 * 帰属が entry_group になり、FK はいずれも **ON DELETE RESTRICT** になった。要件
 * §3.2.6 は「付け替え時、移動元グループの LINE 紐付け・名簿はそのまま移動元に残る」と
 * 定めているので、これらを持つグループは**イベントが0件でも削除しない**のが正しい
 * （削除を試みると FK 違反で付け替えトランザクション全体がロールバックする）。
 * §3.2.6 の「空グループは自動削除」は「依存行を持たない空グループの自動削除」と読む。
 *
 * `line_channels` の FK は SET NULL なので DELETE 自体は通るが、Bot の割当が黙って
 * 解除されてしまうため同様に削除を見送る（プール管理の一貫性）。
 *
 * ※イベント0件のまま残ったグループの linked 紐付けは、UI からは辿れなくなるが
 * `scripts/release-expired-broadcasts.ts` が「イベント0件のグループ」を期限切れ扱いで
 * 解放するため、Bot チャンネルはプールへ戻る。
 *
 * 親行を FOR UPDATE でロックしてから判定する。events → entry_groups への FK 挿入/更新は
 * 親行の FOR KEY SHARE を要求するため、このロックと競合し、削除対象への同時アタッチと
 * 削除自体の race を塞ぐ（既存の admin/members 削除と同じ直列化パターン）。
 */
export async function deleteGroupIfEmpty(tx: DbLike, groupId: number): Promise<void> {
  const locked = await tx
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, groupId))
    .for('update')
  if (locked.length === 0) return // 既に無い（呼び出し二重化など）

  const remaining = await tx
    .select({ id: events.id })
    .from(events)
    .where(eq(events.entryGroupId, groupId))
    .limit(1)
  if (remaining.length > 0) return

  // RESTRICT FK を持つ依存表。1件でもあれば削除しない（残す方が要件に忠実）。
  const broadcast = await tx
    .select({ id: eventLineBroadcasts.id })
    .from(eventLineBroadcasts)
    .where(eq(eventLineBroadcasts.entryGroupId, groupId))
    .limit(1)
  if (broadcast.length > 0) return

  const roster = await tx
    .select({ id: tournamentEntryRosters.id })
    .from(tournamentEntryRosters)
    .where(eq(tournamentEntryRosters.entryGroupId, groupId))
    .limit(1)
  if (roster.length > 0) return

  // roster-file-adoption: 採用済みの原本ファイルも entry_group への RESTRICT FK を
  // 持つ。ここで見落とすと、パース済み名簿は無いがファイル採用だけがあるグループの
  // 削除で FK 違反が飛び、呼び出し側のトランザクション全体がロールバックする。
  const rosterFile = await tx
    .select({ id: tournamentEntryRosterFiles.id })
    .from(tournamentEntryRosterFiles)
    .where(eq(tournamentEntryRosterFiles.entryGroupId, groupId))
    .limit(1)
  if (rosterFile.length > 0) return

  // SET NULL なので DELETE は通るが、黙って Bot 割当を解除しないために見送る。
  const channel = await tx
    .select({ id: lineChannels.id })
    .from(lineChannels)
    .where(eq(lineChannels.assignedEntryGroupId, groupId))
    .limit(1)
  if (channel.length > 0) return

  await tx.delete(entryGroups).where(eq(entryGroups.id, groupId))
}

/**
 * グループ内イベントの**一括 UPDATE の前に**、対象行を id 昇順で FOR UPDATE ロックする。
 *
 * ★`inArray()` を使った単一 UPDATE のロック順は、渡した配列の順序では決まらない
 * （実行計画次第で物理順・任意順になり得る）。「id 昇順で1件ずつ UPDATE」する経路
 * （`setEntriesApplied(true)` / `setPaymentsPaid(true)`）と組み合わさると逆順ロック＝
 * デッドロックが起こり得るため、先に昇順ロックを取って順序を実行計画から切り離す。
 * `ORDER BY` は `FOR UPDATE` より先に評価される（LockRows が Sort の上）ので、
 * ロックは必ずソート順に取得される。
 *
 * グループ再検証（`entry_group_id` 一致）も併記する — ロック対象を後続 UPDATE の WHERE と
 * 完全に一致させ、クライアント申告のグループ外 id を掴まないため（fail-closed）。
 */
export async function lockEventRowsAscending(
  tx: DbLike,
  ids: readonly number[],
  entryGroupId: number,
): Promise<void> {
  if (ids.length === 0) return
  await tx
    .select({ id: events.id })
    .from(events)
    .where(and(inArray(events.id, [...ids]), eq(events.entryGroupId, entryGroupId)))
    .orderBy(asc(events.id))
    .for('update')
}

export type EntryGroupFormAction = 'keep' | 'standalone' | 'merge'

export interface ApplyEntryGroupChangeResult {
  /** 保存後に有効な entry_group_id。'keep' や no-op なら変更前と同じ。 */
  entryGroupId: number
}

/**
 * 編集フォームの「申込グループ」欄からのグループ付け替えを適用する（requirements §3.2.6）。
 * caller の tx 内で呼ぶ。
 *
 * - `'keep'`: 何もしない
 * - `'standalone'`: 既に単独（グループ内が自分だけ）なら no-op（グループ id を無駄に
 *   消費しない）。そうでなければ新しいシングルトングループを作って付け替え、移動元に
 *   対して {@link deleteGroupIfEmpty} を呼ぶ
 * - `'merge'`: `targetGroupId` へ付け替える。**合流先が実在するかを再検証**する
 *   （クライアントの申告を信用しない）。付け替え元と合流先の2グループを **id 昇順で
 *   FOR UPDATE** し、逆向きの同時付け替え同士のデッドロックを避ける。移動元に対して
 *   {@link deleteGroupIfEmpty} を呼ぶ。`targetGroupId` が現在のグループと同じなら no-op
 */
export async function applyEntryGroupChange(
  tx: DbLike,
  eventId: number,
  action: EntryGroupFormAction,
  targetGroupId: number | null,
): Promise<ApplyEntryGroupChangeResult> {
  const current = await tx
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  const currentRow = current[0]
  if (!currentRow) throw new Error('イベントが見つかりません')
  const oldGroupId = currentRow.entryGroupId

  if (action === 'keep') return { entryGroupId: oldGroupId }

  if (action === 'standalone') {
    const siblingIds = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.entryGroupId, oldGroupId))
      .limit(2)
    if (siblingIds.length <= 1) return { entryGroupId: oldGroupId } // 既に単独

    const newGroupId = await createEntryGroup(tx)
    await tx
      .update(events)
      .set({ entryGroupId: newGroupId, updatedAt: new Date() })
      .where(eq(events.id, eventId))
    await deleteGroupIfEmpty(tx, oldGroupId)
    return { entryGroupId: newGroupId }
  }

  // action === 'merge'
  if (targetGroupId == null || !Number.isInteger(targetGroupId)) {
    throw new Error('入力が不正です: 合流先のグループを選択してください')
  }
  if (targetGroupId === oldGroupId) return { entryGroupId: oldGroupId } // no-op

  // デッドロック回避のため id 昇順でロックする。
  const [lowId, highId] =
    oldGroupId < targetGroupId ? [oldGroupId, targetGroupId] : [targetGroupId, oldGroupId]
  const lowRow = await tx
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, lowId))
    .for('update')
  const highRow = await tx
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, highId))
    .for('update')
  const targetExists = (targetGroupId === lowId ? lowRow : highRow).length > 0
  if (!targetExists) {
    throw new Error('合流先のグループが見つかりません。再読み込みして選び直してください')
  }

  await tx
    .update(events)
    .set({ entryGroupId: targetGroupId, updatedAt: new Date() })
    .where(eq(events.id, eventId))
  await deleteGroupIfEmpty(tx, oldGroupId)
  return { entryGroupId: targetGroupId }
}

/**
 * 締切・支払い系の伝播対象フィールド（requirements §3.2.7。これで全部）。
 *
 * `paymentDeadline` と `paymentDeadlineKind` は events の CHECK
 * `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')` で双条件に
 * 縛られているため、**片方だけ伝播させてはならない**（伝播先の状態が古いまま日付
 * だけ入って CHECK 違反 → 500）。{@link diffPropagatableFields} が常に2つを束ねて
 * 返すことで担保している。
 */
export const PROPAGATABLE_FIELD_KEYS = [
  'entryDeadline',
  'internalDeadline',
  'paymentDeadline',
  'paymentDeadlineKind',
  'lotteryDate',
  'paymentMethod',
  'paymentInfo',
  'entryMethod',
] as const

export type PropagatableFieldKey = (typeof PROPAGATABLE_FIELD_KEYS)[number]
/**
 * `paymentDeadlineKind` だけ型が違う（NOT NULL の enum 列なので `null` を書けない）。
 * 他は全て nullable な日付/テキスト列。
 */
export type PropagatableFields = Partial<
  Record<Exclude<PropagatableFieldKey, 'paymentDeadlineKind'>, string | null>
> & { paymentDeadlineKind?: PaymentDeadlineKind }

/**
 * 保存前後の値を比較し、**実際に変わったフィールドだけ**を返す。未変更フィールドを
 * 伝播で上書きすると、伝播対象の日が意図的に持っていた日別差（§3.2.7 で許容）を
 * 消してしまうため、この差分だけを {@link propagateFieldsToGroup} に渡す。
 */
export function diffPropagatableFields(
  before: PropagatableFields,
  after: PropagatableFields,
): PropagatableFields {
  const changed: PropagatableFields = {}
  for (const key of PROPAGATABLE_FIELD_KEYS) {
    // paymentDeadlineKind は型が違う（NOT NULL enum）ため、下でまとめて扱う。
    if (key === 'paymentDeadlineKind') continue
    const oldValue = before[key] ?? null
    const newValue = after[key] ?? null
    if (oldValue !== newValue) changed[key] = newValue
  }
  // 振込締切は「日付」と「状態」が CHECK で双条件に縛られている。片方だけ変わった
  // ときも必ず両方を伝播させないと、伝播先で日付と状態が食い違って CHECK 違反に
  // なる（PROPAGATABLE_FIELD_KEYS の注記を参照）。
  const beforeKind = before.paymentDeadlineKind ?? 'unspecified'
  const afterKind = after.paymentDeadlineKind ?? 'unspecified'
  if ('paymentDeadline' in changed || beforeKind !== afterKind) {
    changed.paymentDeadline = after.paymentDeadline ?? null
    changed.paymentDeadlineKind = afterKind
  }
  return changed
}

export interface PropagateFieldsInput {
  /** 伝播元イベントが属するグループ（re-verification の対象）。 */
  groupId: number
  /** 伝播元イベント自身は対象から除く。 */
  excludeEventId: number
  /** フォームから送られてきた伝播先候補（クライアントの申告。信用しない）。 */
  targetEventIds: readonly number[]
  /** {@link diffPropagatableFields} で求めた「実際に変わったフィールド」。 */
  changed: PropagatableFields
}

/**
 * 締切・支払い系フィールドの伝播を適用する（requirements §3.2.7）。caller の tx 内で呼ぶ。
 *
 * **送られてきた id が本当に同一グループかをここで再検証する**
 * （`WHERE entryGroupId = groupId` を必ず併記。クライアントの申告を信用しない —
 * 一致しない id は無条件に UPDATE 対象から外れる、fail-closed）。
 * `changed` が空、または対象 id が無ければ no-op。
 *
 * 一括 UPDATE なので、`lockEventRowsAscending` で先に id 昇順ロックを取る
 * （編集保存 tx が、進行状態トグルの昇順1件ずつ更新経路とデッドロックしないため）。
 */
export async function propagateFieldsToGroup(
  tx: DbLike,
  input: PropagateFieldsInput,
): Promise<void> {
  const ids = Array.from(
    new Set(input.targetEventIds.filter((id) => id !== input.excludeEventId)),
  ).sort((a, b) => a - b)
  if (ids.length === 0 || Object.keys(input.changed).length === 0) return

  await lockEventRowsAscending(tx, ids, input.groupId)
  await tx
    .update(events)
    .set({ ...input.changed, updatedAt: new Date() })
    .where(and(inArray(events.id, ids), eq(events.entryGroupId, input.groupId)))
}

/** 合流先候補グループ（`listMergeCandidateGroups` の1件）。 */
export interface EntryGroupMergeCandidate {
  groupId: number
  /** 導出表示名（導出不能時は代表イベントのタイトル）。 */
  name: string
  /** 代表イベントの開催日 `YYYY-MM-DD`。 */
  representativeEventDate: string
  eventCount: number
}

/**
 * 合流先候補を返す（requirements §3.2.6: 「同じ tournament_draft 由来のグループ＋
 * 開催日が近い順の全グループ検索」）。`eventId` 自身のグループは除く。
 *
 * 同一 `tournamentDraftId` 由来のグループを先頭に、それ以外は代表イベントの開催日が
 * `todayStr` に近い順で並べ、`limit` 件に切る（編集フォームの合流候補一覧。全件検索は
 * このタスクのスコープ外——サーバーで有界なリストを渡し、クライアント側のテキスト
 * フィルタで絞り込む）。
 */
export async function listMergeCandidateGroups(
  db: DbLike,
  eventId: number,
  todayStr: string,
  limit = 30,
): Promise<EntryGroupMergeCandidate[]> {
  const current = await db
    .select({ entryGroupId: events.entryGroupId, tournamentDraftId: events.tournamentDraftId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  const currentRow = current[0]
  if (!currentRow) return []

  const others = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      entryGroupId: events.entryGroupId,
      tournamentDraftId: events.tournamentDraftId,
    })
    .from(events)

  const byGroup = new Map<number, typeof others>()
  for (const e of others) {
    if (e.entryGroupId === currentRow.entryGroupId) continue
    const arr = byGroup.get(e.entryGroupId)
    if (arr) arr.push(e)
    else byGroup.set(e.entryGroupId, [e])
  }

  const ranked: (EntryGroupMergeCandidate & { sameDraft: boolean; distanceDays: number })[] = []
  for (const [groupId, groupEvents] of byGroup) {
    const rep = selectRepresentativeEvent(groupEvents, todayStr)
    if (!rep) continue
    const name = deriveEntryGroupName(groupEvents.map((e) => e.title)) ?? rep.title
    const sameDraft =
      currentRow.tournamentDraftId != null &&
      groupEvents.some((e) => e.tournamentDraftId === currentRow.tournamentDraftId)
    ranked.push({
      groupId,
      name,
      representativeEventDate: rep.eventDate,
      eventCount: groupEvents.length,
      sameDraft,
      distanceDays: Math.abs(diffDays(todayStr, rep.eventDate)),
    })
  }

  ranked.sort((a, b) => {
    if (a.sameDraft !== b.sameDraft) return a.sameDraft ? -1 : 1
    return a.distanceDays - b.distanceDays
  })

  return ranked.slice(0, limit).map(({ sameDraft, distanceDays, ...c }) => c)
}
