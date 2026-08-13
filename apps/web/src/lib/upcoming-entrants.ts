import { and, eq, gte, inArray, isNull, ne, notInArray } from 'drizzle-orm'
import type { Grade } from '@kagetra/shared/types'
import {
  events,
  eventAttendances,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  tournamentSeries,
  tournamentSeriesEditions,
  users,
} from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { isGuestRole } from '@/lib/guest-access'

/**
 * ホーム（`/dashboard`）・外部向け出場者 API が共有する「出場予定の会員」導出。
 *
 * 母集団・絞り込みの規約（design-spec §6 で確定）:
 * - 母集団: `/admin/entries` と同じ（`event_date >= since` ∧ `status <> 'cancelled'`
 *   ∧ `kind = 'individual'`）。**出場者 0 名のイベントも含めて返す** — 呼び出し側の
 *   母集団判定（ホームの未回答アラート等）がこの関数の結果に依存するため。
 * - 出場者「希望」（`basis: 'attendance'`）: `event_attendances.attend = true` ∧
 *   `users.is_invited = true` ∧ 対象級内（イベント詳細 AC-26 と同じ）
 * - 出場者「確定」（`basis: 'roster'`）: `tournament_entry_rosters` の
 *   `roster_type = 'confirmed'` かつ `superseded_at IS NULL` の版に属する
 *   `tournament_entry_roster_entries`（名簿の帰属は event ではなく `entry_group_id`）
 * - guest-role R5/AC-22: 確定名簿があるイベントでも、ゲスト（`users.role = 'guest'`）
 *   だけは出欠回答（`attend = true`）から別に合流する — ゲストは会の申込名簿に
 *   構造的に載らないため。会員は名簿だけが正のまま変えない（design-spec §7 の
 *   意図的な非対称）
 */

/** 出場者の出所。名簿由来なら `roster`、出欠回答由来（希望パス／ゲスト合流）なら `attendance`。 */
export type EntrantBasis = 'roster' | 'attendance'

export interface UpcomingEntrant {
  /**
   * 会員 id。
   * - `roster`: `tournament_entry_roster_entries.user_id`（`users` への innerJoin
   *   ＝「自会員として同定できた行」だけをここに載せるので常に非 null）
   * - `attendance`: `event_attendances.user_id`
   */
  userId: string
  /** `users.name`（合成表示名）。未設定の会員は null。 */
  name: string | null
  familyKana: string | null
  givenKana: string | null
  /**
   * その大会で出る級（＝チップの級）。`roster` なら名簿行の `grade`、
   * `attendance` なら常に null（名簿行が無いので）。呼び出し側は
   * `entryGrade ?? userGrade` で「表示すべき級」を導出する。
   */
  entryGrade: Grade | null
  /** 現在の `users.grade`。名簿行の級とは別に、常に「今の級」として持つ。 */
  userGrade: Grade | null
  /**
   * guest-role: `users.role === 'guest'` か。確定名簿があるイベントでも、
   * ゲストは出欠回答から合流した `basis: 'attendance'` の行として混ざりうる。
   */
  isGuest: boolean
  basis: EntrantBasis
}

export interface UpcomingEntrantsEvent {
  id: number
  entryGroupId: number
  title: string
  /** 通称。edition 未紐付けの大会は null。 */
  shortName: string | null
  /** `YYYY-MM-DD`。 */
  eventDate: string
  location: string | null
  eligibleGrades: Grade[] | null
  internalDeadline: string | null
  entryDeadline: string | null
  /** 確定名簿があるイベントか（`confidence` 導出用）。 */
  hasConfirmedRoster: boolean
  /**
   * 出場者。`hasConfirmedRoster` のときは**出場する人だけ**を含める
   * （補欠・落選はホームに出さない）。
   *
   * 「出場する人」の定義（design-spec §6 で確定）:
   * `status IN ('confirmed', 'carried_up')` ∧
   * `selection_outcome NOT IN ('waitlisted', 'rejected')` ∧ `user_id IS NOT NULL`。
   *
   * **現在の `users.grade` では絞らない**（確定パスの絞りは上の 3 条件だけ）——
   * 名簿がその大会の出場者の唯一の権威で、現在の級で絞ると昇級者が名簿から消える。
   */
  entrants: UpcomingEntrant[]
}

/** 対象級判定。空/null の `eligible_grades` は「全員が対象」（イベント詳細と同じ）。 */
function isEligibleGrade(
  eligibleGrades: Grade[] | null,
  grade: Grade | null,
): boolean {
  if (!eligibleGrades?.length) return true
  return grade != null && eligibleGrades.includes(grade)
}

/**
 * userId で重複排除する（先勝ち）。確定パスは名簿由来（会員）とゲスト合流
 * （出欠回答）の 2 集合を合成するため、同じ人が両方に入る余地を構造的に消す
 * 最終防波堤。呼び出し側は会員側を先に spread する。
 */
function dedupeByUserId(entrants: UpcomingEntrant[]): UpcomingEntrant[] {
  const byUserId = new Map<string, UpcomingEntrant>()
  for (const e of entrants) {
    if (!byUserId.has(e.userId)) byUserId.set(e.userId, e)
  }
  return [...byUserId.values()]
}

/**
 * 出場予定の会員を、開催日 `since` 以降のイベント単位で返す。
 *
 * `since` は呼び出し側が渡す（ホームは `todayInJst()`、外部向け API は当月1日
 * 等）。母集団が数十件規模なのでクエリ本数を固定する（イベントごとには投げない）。
 */
export async function getUpcomingEntrants({
  since,
}: {
  since: string
}): Promise<UpcomingEntrantsEvent[]> {
  // ① 母集団（`/admin/entries` と同条件）＋ 通称。edition_id は nullable なので
  //    leftJoin にする — innerJoin にすると edition 未紐付けの大会が丸ごと消える。
  const eventRows = await db
    .select({
      id: events.id,
      entryGroupId: events.entryGroupId,
      title: events.title,
      shortName: tournamentSeries.shortName,
      eventDate: events.eventDate,
      location: events.location,
      eligibleGrades: events.eligibleGrades,
      internalDeadline: events.internalDeadline,
      entryDeadline: events.entryDeadline,
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
        gte(events.eventDate, since),
        ne(events.status, 'cancelled'),
        eq(events.kind, 'individual'),
      ),
    )

  // 母集団が空なら以降のクエリを投げる意味がない（inArray に空配列を渡さない
  // ためのガードも兼ねる）。
  if (eventRows.length === 0) return []

  const eventIds = eventRows.map((e) => e.id)
  const groupIds = [...new Set(eventRows.map((e) => e.entryGroupId))]

  // ② 出欠。ここでは希望パス・ゲスト合流にしか使わないので `attend = true` に
  //    絞ってよい（page.tsx 側の未回答アラートは attend を絞らない別クエリを持つ）。
  const attendanceRows = await db
    .select({
      eventId: eventAttendances.eventId,
      userId: eventAttendances.userId,
    })
    .from(eventAttendances)
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.attend, true),
      ),
    )

  // ③ 確定名簿（`roster_type='confirmed'` ∧ 差し替え前）。名簿の帰属は event では
  //    なく entry_group（`/admin/entries` と同じ）。
  const rosterRows = await db
    .select({
      id: tournamentEntryRosters.id,
      entryGroupId: tournamentEntryRosters.entryGroupId,
    })
    .from(tournamentEntryRosters)
    .where(
      and(
        inArray(tournamentEntryRosters.entryGroupId, groupIds),
        eq(tournamentEntryRosters.rosterType, 'confirmed'),
        isNull(tournamentEntryRosters.supersededAt),
      ),
    )

  // ④ 確定名簿の各行のうち「出場する人」（design-spec §6 で確定した定義）。
  //    絞りは status / selection_outcome / user_id の 3 条件だけ —— 名簿がその大会の
  //    出場者の唯一の権威なので、現在の `users.grade` では絞らない（昇級者が実際に
  //    載っている名簿から消えてしまう）。`users` への innerJoin が
  //    「自会員として同定できた行」＝ `user_id IS NOT NULL` を兼ねる。
  const rosterIds = rosterRows.map((r) => r.id)
  const rosterEntryRows =
    rosterIds.length === 0
      ? []
      : await db
          .select({
            rosterId: tournamentEntryRosterEntries.rosterId,
            userId: tournamentEntryRosterEntries.userId,
            // ★チップの級はこちら（＝その大会で出る級）が優先。
            entryGrade: tournamentEntryRosterEntries.grade,
            userName: users.name,
            familyKana: users.familyKana,
            givenKana: users.givenKana,
            userGrade: users.grade,
          })
          .from(tournamentEntryRosterEntries)
          .innerJoin(users, eq(users.id, tournamentEntryRosterEntries.userId))
          .where(
            and(
              inArray(tournamentEntryRosterEntries.rosterId, rosterIds),
              inArray(tournamentEntryRosterEntries.status, [
                'confirmed',
                'carried_up',
              ]),
              notInArray(tournamentEntryRosterEntries.selectionOutcome, [
                'waitlisted',
                'rejected',
              ]),
              // guest-role: ゲストは会経由で申し込まないので、名簿に載っているのは
              // 「登録会が変わって過去に会員だった名残」（管理者が後から role を
              // guest へ変更したケース）でしかない。会員は名簿が正・ゲストは
              // 出欠回答が唯一の正という非対称（design-spec §7）を保つため、現在の
              // role が guest の行は名簿由来の集合から落とし、ゲスト合流
              // （entrantsFromAttendance の guestsOnly）にだけ委ねる。
              ne(users.role, 'guest'),
            ),
          )

  // ⑤ eligible 会員 + ゲスト（**希望パス・確定パスのゲスト合流の両方で使う**）。
  //    イベント詳細 AC-26 と同じ母集団（`is_invited=true` ∧ 対象級。
  //    `eligible_grades` が空/null なら is_invited のみ）。ゲストは登録時に
  //    必ず `is_invited=true` になる（requirements R1）ので、role を除外しない
  //    限りここに混ざる —— それを利用して希望パスは会員・ゲストを区別せず拾い、
  //    確定パスはこの中からゲストだけを合流させる（下の entrantsFromAttendance）。
  //    級ごとに集合が変わるので、対象者を 1 回引いて JS 側でイベント単位に絞る。
  const invitedUsers = await db
    .select({
      id: users.id,
      name: users.name,
      familyKana: users.familyKana,
      givenKana: users.givenKana,
      grade: users.grade,
      role: users.role,
    })
    .from(users)
    .where(eq(users.isInvited, true))
  const invitedUserById = new Map(invitedUsers.map((u) => [u.id, u]))

  // --- 索引 -----------------------------------------------------------------

  const rosterIdsByGroup = new Map<number, number[]>()
  for (const r of rosterRows) {
    const arr = rosterIdsByGroup.get(r.entryGroupId)
    if (arr) arr.push(r.id)
    else rosterIdsByGroup.set(r.entryGroupId, [r.id])
  }

  const rosterEntriesByRosterId = new Map<number, typeof rosterEntryRows>()
  for (const row of rosterEntryRows) {
    const arr = rosterEntriesByRosterId.get(row.rosterId)
    if (arr) arr.push(row)
    else rosterEntriesByRosterId.set(row.rosterId, [row])
  }

  const attendancesByEvent = new Map<number, typeof attendanceRows>()
  for (const row of attendanceRows) {
    const arr = attendancesByEvent.get(row.eventId)
    if (arr) arr.push(row)
    else attendancesByEvent.set(row.eventId, [row])
  }

  // --- 出場者の組み立て -----------------------------------------------------

  /**
   * 確定名簿から 1 イベントぶんの出場者を作る。
   *
   * 名簿は **entry_group 単位**なので、同じグループの各日は同じ出場者リストを
   * 共有する（design-spec §6 が確定させた読み方。名簿行の `grade` を使って日ごとに
   * 割り当て直すことは**しない**）。将来その方針を変えるなら、変更点はこの関数だけ。
   */
  function confirmedEntrantsOf(entryGroupId: number): UpcomingEntrant[] {
    // 同一グループに非 superseded な確定名簿が複数ある異常系でも二重に出さない。
    const byUserId = new Map<string, UpcomingEntrant>()
    for (const rosterId of rosterIdsByGroup.get(entryGroupId) ?? []) {
      for (const row of rosterEntriesByRosterId.get(rosterId) ?? []) {
        if (row.userId == null || byUserId.has(row.userId)) continue
        byUserId.set(row.userId, {
          userId: row.userId,
          name: row.userName,
          familyKana: row.familyKana,
          givenKana: row.givenKana,
          entryGrade: row.entryGrade,
          userGrade: row.userGrade,
          // guest-role: 確定名簿の行は常に「会員として同定できた」ゲート
          // （innerJoin）を通っているので、ここに現れるのは会員だけ。
          // ゲストは名簿に構造的に載らない（requirements §7）。
          isGuest: false,
          basis: 'roster',
        })
      }
    }
    return [...byUserId.values()]
  }

  /**
   * 出欠（`attend=true`）から 1 イベントぶんの出場者を作る共通処理。
   * 対象級外の stale 行はここで落とす（イベント詳細 AC-26 と同じ）。
   *
   * `guestsOnly` は確定パス専用の合流口 —— guest-role AC-22: 確定名簿がある
   * グループでも、名簿は会経由で申し込まないゲストを構造的に含まないため、
   * ゲストだけは出欠回答を正として別に足す（会員は名簿だけが正のまま。
   * design-spec §7 の意図的な非対称）。**新しいクエリは投げない**
   * —— ②の attendanceRows と ⑤の invitedUsers を再利用するだけ。
   */
  function entrantsFromAttendance(
    eventId: number,
    eligibleGrades: Grade[] | null,
    { guestsOnly }: { guestsOnly: boolean },
  ): UpcomingEntrant[] {
    return (attendancesByEvent.get(eventId) ?? []).flatMap((a) => {
      const user = invitedUserById.get(a.userId)
      if (!user || !isEligibleGrade(eligibleGrades, user.grade)) return []
      const isGuest = isGuestRole(user.role)
      if (guestsOnly && !isGuest) return []
      return [
        {
          userId: user.id,
          name: user.name,
          familyKana: user.familyKana,
          givenKana: user.givenKana,
          entryGrade: null,
          userGrade: user.grade,
          isGuest,
          basis: 'attendance' as const,
        },
      ]
    })
  }

  return eventRows.map((e) => {
    // 確定名簿があるグループは確定パス。無ければ出欠（希望）へフォールバックする。
    const hasConfirmedRoster =
      (rosterIdsByGroup.get(e.entryGroupId) ?? []).length > 0
    const entrants = hasConfirmedRoster
      ? // guest-role AC-22: 確定パスでも、名簿には構造的に載らないゲストを
        // 出欠回答から合流させる（会員は名簿ベースのまま。上の
        // entrantsFromAttendance の doc コメントが理由の正典）。dedupeByUserId は
        // 保険 —— 名簿クエリ側の role フィルタが効いていれば重複は起きないが、
        // 万一同じ userId が両集合に入っても人数を過大にしない。
        dedupeByUserId([
          ...confirmedEntrantsOf(e.entryGroupId),
          ...entrantsFromAttendance(e.id, e.eligibleGrades, {
            guestsOnly: true,
          }),
        ])
      : // 確定名簿が無いイベントの出場者（希望パス）。会員・ゲストを区別せず拾う。
        entrantsFromAttendance(e.id, e.eligibleGrades, { guestsOnly: false })

    return {
      id: e.id,
      entryGroupId: e.entryGroupId,
      title: e.title,
      shortName: e.shortName,
      eventDate: e.eventDate,
      location: e.location,
      eligibleGrades: e.eligibleGrades,
      internalDeadline: e.internalDeadline,
      entryDeadline: e.entryDeadline,
      hasConfirmedRoster,
      entrants,
    }
  })
}
