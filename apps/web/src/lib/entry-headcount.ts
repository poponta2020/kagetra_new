import { and, eq, inArray, ne } from 'drizzle-orm'
import { eventAttendances, events, users } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * entry-headcount: 申込グループの「景虎上の申込人数」（event-line-broadcast §3.1.3 の③）。
 *
 * ★母集団は**参加費集計（`entry-fee-tally.ts`）とは別物**。混同しないこと:
 *
 * |            | この関数（③）        | `tallyEntryFeesForGroup`（参加費） |
 * |------------|---------------------|-----------------------------------|
 * | 数え方      | **実人数**（グループ全体で重複排除） | **延べ**（1日ごとに参加費が発生する） |
 * | ゲスト      | **含む**（内訳を「内他会」で併記） | 除く（会として申し込む人数ではない）   |
 *
 * ③の数字は **LINE グループの在籍人数と突き合わせるため**のもので、グループには
 * 他会の参加者も入る。一方の参加費は「会として何人ぶん申し込むか」なので母集団が違う。
 * 同じグループで2つの人数が並ぶことを要件が明示的に許容している（event-line-broadcast §3.1.3）。
 *
 * 対象級の絞り込みは大会詳細の `eligibleAttendingList` と同じ規則:
 * ```
 * eligible_grades が非空 → is_invited = true AND grade IN (eligible_grades)
 * eligible_grades が NULL/空配列 → is_invited = true だけ
 * ```
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-fee-tally.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

export interface EntryHeadcount {
  /** 参加と回答した実人数（ゲスト込み・グループ全体で重複排除）。 */
  total: number
  /** うちゲスト（他会）の人数。 */
  guests: number
}

/**
 * グループ全日の「参加」回答を重複排除して数える。中止した日は数えない
 * （`tallyEntryFeesForGroup` と同じく `status='cancelled'` を除く）。
 */
export async function countGroupEntrants(
  dbc: DbOrTx,
  entryGroupId: number,
): Promise<EntryHeadcount> {
  const eventRows = await dbc
    .select({ id: events.id, eligibleGrades: events.eligibleGrades })
    .from(events)
    .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))

  // userId → ゲストかどうか。同じ会員が複数日に出ていても1人として数える。
  const seen = new Map<string, boolean>()
  for (const ev of eventRows) {
    const gradeFilter = ev.eligibleGrades?.length
      ? and(eq(users.isInvited, true), inArray(users.grade, ev.eligibleGrades))
      : eq(users.isInvited, true)

    const rows = await dbc
      .select({ userId: eventAttendances.userId, role: users.role })
      .from(eventAttendances)
      .innerJoin(users, eq(eventAttendances.userId, users.id))
      .where(and(eq(eventAttendances.eventId, ev.id), eq(eventAttendances.attend, true), gradeFilter))

    for (const row of rows) seen.set(row.userId, row.role === 'guest')
  }

  let guests = 0
  for (const isGuest of seen.values()) if (isGuest) guests++
  return { total: seen.size, guests }
}

/**
 * ③の人数表記。`〇名（内他会〇名）`。**ゲストが0名なら括弧ごと省略**する
 * （event-line-broadcast §3.1.3・AC-24）。
 *
 * 数値だけを返す純関数にしてあるのは、この文字列が `textV2`（メンション付き）の
 * 本文に入るため — 自由記述を混ぜられない制約（§3.2.2）に沿って、呼び出し側が
 * 数値として `buildMentionMessage` へ渡せるようにしている。
 */
export function formatEntrantCountParts(count: EntryHeadcount): {
  template: string
  values: number[]
} {
  return count.guests > 0
    ? { template: '%s名（内他会%s名）', values: [count.total, count.guests] }
    : { template: '%s名', values: [count.total] }
}
