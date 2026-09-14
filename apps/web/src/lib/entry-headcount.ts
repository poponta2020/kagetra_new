import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { eventAttendances, events, users } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * entry-headcount: 申込グループの「LINE グループにいるはずの人数」（event-line-broadcast
 * §3.1.3a の③）。ここは**事実を DB から集めるだけ**で、行の組み立て・排他・注記は
 * pure な `entry-headcount-breakdown.ts` が担う（`entry-fee.ts` ↔ `entry-fee-tally.ts` と同じ流儀）。
 *
 * ★母集団は**参加費集計（`entry-fee-tally.ts`）とは別物**。混同しないこと:
 *
 * |            | この関数（③）        | `tallyEntryFeesForGroup`（参加費） |
 * |------------|---------------------|-----------------------------------|
 * | 数え方      | **実人数**（グループ全体で重複排除） | **延べ**（1日ごとに参加費が発生する） |
 * | ゲスト      | **除く**（人数には数えず、遠征届の要否判定にだけ使う） | 除く（会として申し込む人数ではない） |
 *
 * ③の数字は **LINE グループの在籍人数と突き合わせるため**のもの。2026-09-14 の改訂で
 * 「グループには他会の参加者も入る」という前提が反転し、ゲストは大会別 LINE グループに
 * 招待しない運用になったため**ゲストはどの行にも数えない**（「内他会〇名」の併記は廃止）。
 * 一方の参加費は「会として何人ぶん申し込むか」なので、元から母集団が違う。
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

/** 内訳の役割行に出す1人。`displayName` は `family_name ?? name`（§3.1.3a）。 */
export interface HeadcountRoleHolder {
  userId: string
  displayName: string
}

/**
 * ③の内訳を組み立てるのに必要な事実一式。**判断は一切含めない**
 * （排他・遠征届の要否・注記は `buildHeadcountBreakdown` の仕事）。
 */
export interface GroupHeadcountFacts {
  /** ゲストを除いた参加者の userId（グループ全体で重複排除）。**人数は `.size`**
   *  — 件数を別フィールドで持たせると集合と食い違い得るので持たない。 */
  entrantUserIds: ReadonlySet<string>
  /** ゲスト（`role='guest'`）の参加者が1人以上いるか（遠征届の要否判定にだけ使う）。 */
  hasGuestEntrant: boolean
  /** サークル所属 ON の参加会員が1人以上いるか（同上）。 */
  hasCircleMemberEntrant: boolean
  /** `role='admin'`（`vice_admin` は含めない。§3.1.3a）。 */
  admins: HeadcountRoleHolder[]
  /** `is_treasurer = true`。 */
  treasurers: HeadcountRoleHolder[]
  /** `is_travel_report_submitter = true`。 */
  travelReportSubmitters: HeadcountRoleHolder[]
}

export interface EntryHeadcount {
  /** 参加と回答した実人数（ゲスト込み・グループ全体で重複排除）。 */
  total: number
  /** うちゲスト（他会）の人数。 */
  guests: number
}

/** 対象イベントの級フィルタ（`eligibleAttendingList` と同じ規則）。 */
function gradeFilterFor(eligibleGrades: (typeof events.$inferSelect)['eligibleGrades']) {
  return eligibleGrades?.length
    ? and(eq(users.isInvited, true), inArray(users.grade, eligibleGrades))
    : eq(users.isInvited, true)
}

/**
 * ③の内訳の材料を1回で集める（§3.1.3a）。
 *
 * 参加者の母集団は `countGroupEntrants` と同じ（中止日を除く・級フィルタ・
 * グループ全体で重複排除）で、**ゲストだけ扱いが違う** — 人数には数えず、
 * 「ゲスト参加者がいるか」のフラグとしてだけ持ち帰る。
 *
 * 役割保持者は `line_user_id IS NOT NULL AND deactivated_at IS NULL` の人だけを
 * `users.id` 昇順で返す（LINE を紐付けていない人はグループに入れないため。AC-H6）。
 * 3種を1クエリで取って JS 側で仕分けるのは、兼務している人に同じ並び順を保証するため。
 */
export async function loadGroupHeadcountFacts(
  dbc: DbOrTx,
  entryGroupId: number,
): Promise<GroupHeadcountFacts> {
  const eventRows = await dbc
    .select({ id: events.id, eligibleGrades: events.eligibleGrades })
    .from(events)
    .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))

  const entrantUserIds = new Set<string>()
  let hasGuestEntrant = false
  let hasCircleMemberEntrant = false

  for (const ev of eventRows) {
    const rows = await dbc
      .select({
        userId: eventAttendances.userId,
        role: users.role,
        isCircleMember: users.isCircleMember,
      })
      .from(eventAttendances)
      .innerJoin(users, eq(eventAttendances.userId, users.id))
      .where(
        and(
          eq(eventAttendances.eventId, ev.id),
          eq(eventAttendances.attend, true),
          gradeFilterFor(ev.eligibleGrades),
        ),
      )

    for (const row of rows) {
      if (row.role === 'guest') {
        hasGuestEntrant = true
        continue
      }
      entrantUserIds.add(row.userId)
      if (row.isCircleMember) hasCircleMemberEntrant = true
    }
  }

  const roleRows = await dbc
    .select({
      id: users.id,
      name: users.name,
      familyName: users.familyName,
      role: users.role,
      isTreasurer: users.isTreasurer,
      isTravelReportSubmitter: users.isTravelReportSubmitter,
    })
    .from(users)
    .where(
      and(
        or(
          eq(users.role, 'admin'),
          eq(users.isTreasurer, true),
          eq(users.isTravelReportSubmitter, true),
        ),
        isNotNull(users.lineUserId),
        isNull(users.deactivatedAt),
      ),
    )
    .orderBy(asc(users.id))

  const admins: HeadcountRoleHolder[] = []
  const treasurers: HeadcountRoleHolder[] = []
  const travelReportSubmitters: HeadcountRoleHolder[] = []
  for (const row of roleRows) {
    // 本番は全会員が family_name 済み。NULL のときは合成表示名の `name` を出す（AC-H7）。
    const holder: HeadcountRoleHolder = {
      userId: row.id,
      displayName: row.familyName ?? row.name ?? '',
    }
    if (row.role === 'admin') admins.push(holder)
    if (row.isTreasurer) treasurers.push(holder)
    if (row.isTravelReportSubmitter) travelReportSubmitters.push(holder)
  }

  return {
    entrantUserIds,
    hasGuestEntrant,
    hasCircleMemberEntrant,
    admins,
    treasurers,
    travelReportSubmitters,
  }
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
