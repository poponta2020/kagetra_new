import { redirect } from 'next/navigation'
import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm'
import {
  events,
  eventAttendances,
  tournamentEntryRosters,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { todayInJst } from '@/lib/jst-date'
import { EntryBoardClient } from './EntryBoardClient'
import type { EntryBoardItem } from './entry-board-utils'

export const dynamic = 'force-dynamic'

/**
 * 申込管理ボード（管理者専用）。
 *
 * 進行フェーズは永続カラムを持たず、既存列（entry_status / payment_* / 各締切）と
 * 既存テーブル（出欠・確定名簿）から毎回導出する。仕分け・並び順・締切表示の判断は
 * すべて entry-board-utils.ts の純関数側にあり、ここはその入力 DTO を組むだけ。
 *
 * 母集団は数十件規模なのでクエリは 3 本に固定する（区画ごとに投げない）。
 * 要件: docs/features/entry-management/requirements.md §3.2
 */
export default async function EntryManagementPage() {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // JST today。events の日付列は YYYY-MM-DD なので辞書順比較で正しい。
  // クライアントへ渡して共有する（クライアントで Date.now() を呼ぶと
  // hydration mismatch になる。event-list-utils.ts と同じ制約）。
  const todayStr = todayInJst()

  // ① 母集団（§3.2.1 の条件 1〜3）＋ 通称。非表示条件（§3.2.4）は純関数側の
  //    classify が判定するのでここでは落とさない。
  //    edition_id は nullable なので leftJoin にする — innerJoin にすると
  //    edition 未紐付けの大会が母集団から丸ごと消える。
  //    entryGroupId はタスク6のカード集約キー（母集団の条件自体は変えない）。
  const eventRows = await db
    .select({
      id: events.id,
      entryGroupId: events.entryGroupId,
      title: events.title,
      shortName: tournamentSeries.shortName,
      eventDate: events.eventDate,
      eligibleGrades: events.eligibleGrades,
      internalDeadline: events.internalDeadline,
      entryDeadline: events.entryDeadline,
      paymentDeadline: events.paymentDeadline,
      lotteryDate: events.lotteryDate,
      entryStatus: events.entryStatus,
      paymentType: events.paymentType,
      paymentStatus: events.paymentStatus,
    })
    .from(events)
    .leftJoin(
      tournamentSeriesEditions,
      eq(tournamentSeriesEditions.id, events.editionId),
    )
    .leftJoin(
      tournamentSeries,
      eq(tournamentSeries.id, tournamentSeriesEditions.seriesId),
    )
    .where(
      and(
        gte(events.eventDate, todayStr),
        ne(events.status, 'cancelled'),
        eq(events.kind, 'individual'),
      ),
    )

  const eventIds = eventRows.map((e) => e.id)

  // ② 参加希望者数。attend=true の素通し件数（/events 一覧と同じセマンティクス。
  //    対象級・isInvited で絞らない）。表示中の大会ぶんを 1 クエリで取り JS で集計する。
  //    inArray に空配列を渡さないよう母集団 0 件なら投げない。
  const attendanceRows =
    eventIds.length === 0
      ? []
      : await db
          .select({ eventId: eventAttendances.eventId })
          .from(eventAttendances)
          .where(
            and(
              inArray(eventAttendances.eventId, eventIds),
              eq(eventAttendances.attend, true),
            ),
          )

  const attendCountByEvent = new Map<number, number>()
  for (const row of attendanceRows) {
    attendCountByEvent.set(row.eventId, (attendCountByEvent.get(row.eventId) ?? 0) + 1)
  }

  // ③ 確定名簿の有無。roster_type='confirmed' かつ superseded_at IS NULL の行が
  //    1 つでもあれば true（申込者名簿・差し替え済みの版は数えない）。
  const rosterRows =
    eventIds.length === 0
      ? []
      : await db
          .select({ eventId: tournamentEntryRosters.eventId })
          .from(tournamentEntryRosters)
          .where(
            and(
              inArray(tournamentEntryRosters.eventId, eventIds),
              eq(tournamentEntryRosters.rosterType, 'confirmed'),
              isNull(tournamentEntryRosters.supersededAt),
            ),
          )

  const eventIdsWithConfirmedRoster = new Set(rosterRows.map((r) => r.eventId))

  // ④ タスク6: グループ表示名・代表イベントはグループごとに一度だけ計算する
  //    （`@/lib/entry-groups` の正典実装。呼び出し側で再実装しない）。
  //    entry-board-utils.ts はクライアントコンポーネント（EntryBoardClient.tsx）
  //    から import されるため、DB 層に依存する `@/lib/entry-groups` をそこから
  //    import すると client バンドルへ漏れる。ここ（サーバー）で計算し、
  //    結果を平らな値として EntryBoardItem に持たせる。
  const membersByGroup = new Map<number, typeof eventRows>()
  for (const row of eventRows) {
    const arr = membersByGroup.get(row.entryGroupId)
    if (arr) arr.push(row)
    else membersByGroup.set(row.entryGroupId, [row])
  }
  const groupMetaById = new Map<
    number,
    { name: string; representativeEventId: number }
  >()
  for (const [groupId, members] of membersByGroup) {
    // members は eventRows からグループ化しただけなので必ず1件以上あり、
    // selectRepresentativeEvent は非 null を返す。
    const representative = selectRepresentativeEvent(members, todayStr)!
    const name = deriveEntryGroupName(members.map((m) => m.title)) ?? representative.title
    groupMetaById.set(groupId, { name, representativeEventId: representative.id })
  }

  const items: EntryBoardItem[] = eventRows.map((e) => {
    const groupMeta = groupMetaById.get(e.entryGroupId)
    if (!groupMeta) {
      // membersByGroup は eventRows 自身から作っているので理論上ここには来ない。
      // クエリ形状が将来変わって前提が崩れたときに早期に気付けるようにする
      // （非 null アサーションで無言に undefined を通さない）。
      throw new Error(`グループ情報が見つかりません: entry_group_id=${e.entryGroupId}`)
    }
    return {
      id: e.id,
      entryGroupId: e.entryGroupId,
      groupName: groupMeta.name,
      groupRepresentativeEventId: groupMeta.representativeEventId,
      title: e.title,
      shortName: e.shortName,
      eventDate: e.eventDate,
      eligibleGrades: e.eligibleGrades,
      internalDeadline: e.internalDeadline,
      entryDeadline: e.entryDeadline,
      paymentDeadline: e.paymentDeadline,
      lotteryDate: e.lotteryDate,
      entryStatus: e.entryStatus,
      paymentType: e.paymentType,
      paymentStatus: e.paymentStatus,
      attendCount: attendCountByEvent.get(e.id) ?? 0,
      hasConfirmedRoster: eventIdsWithConfirmedRoster.has(e.id),
    }
  })

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-xl font-bold text-ink">申込管理</h1>
      <EntryBoardClient items={items} todayStr={todayStr} />
    </div>
  )
}
