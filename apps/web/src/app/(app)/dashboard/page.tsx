import { redirect } from 'next/navigation'
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
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isGuestRole } from '@/lib/guest-access'
import { diffDays, todayInJst } from '@/lib/jst-date'
import { surname } from '@/lib/surname'
// 表示名（通称 + 対象級）の導出は `/admin/entries` の純関数が唯一の実装なので
// 再実装しない（design-spec §6「大会表示名」）。引数は `NameSource`（title /
// shortName / eligibleGrades だけの構造型）なので、①のクエリ行をそのまま渡せる。
import { displayName } from '@/app/(app)/admin/entries/entry-board-utils'
import { HomeTimeline } from './HomeTimeline'
import type {
  HomeEntrant,
  HomeTimelineData,
  HomeTimelineEvent,
  HomeUnansweredAlert,
} from './home-timeline-types'

export const dynamic = 'force-dynamic'

/** 未回答アラートを出す窓（基準締切の N 日前から締切当日まで）。 */
const ALERT_WINDOW_DAYS = 7

/** 級の昇順（A が先・null は末尾）。イベント詳細の参加者一覧と同じ並び。 */
const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']
function gradeRank(grade: Grade | null): number {
  const i = grade == null ? -1 : GRADE_ORDER.indexOf(grade)
  return i < 0 ? GRADE_ORDER.length : i
}

/** 対象級判定。空/null の `eligible_grades` は「全員が対象」（イベント詳細と同じ）。 */
function isEligibleGrade(
  eligibleGrades: Grade[] | null,
  grade: Grade | null,
): boolean {
  if (!eligibleGrades?.length) return true
  return grade != null && eligibleGrades.includes(grade)
}

/** 級昇順 → 姓（日本語ロケール）で安定させる（非破壊）。 */
function sortEntrants(entrants: HomeEntrant[]): HomeEntrant[] {
  return entrants
    .slice()
    .sort(
      (a, b) =>
        gradeRank(a.grade) - gradeRank(b.grade) ||
        a.surname.localeCompare(b.surname, 'ja'),
    )
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * ホーム（`/dashboard`）= 会の出場予定。
 *
 * サーバー側の仕事は {@link HomeTimelineData} を組むことだけで、表示は
 * HomeTimeline.tsx が全部持つ。母集団・絞り込みの規約は home-timeline-types.ts の
 * doc コメントが正典（design-spec §6）。あいさつ・権限カードは撤去した。
 *
 * 母集団は数十件規模なのでクエリ本数を固定する（イベントごとには投げない。
 * `/admin/entries` の page.tsx が手本）。
 */
export default async function DashboardPage() {
  const session = await auth()
  // 未ログイン・会員未紐付けは通さない（通常は middleware が先に弾く。ここは
  // その fail-safe。`/admin/entries` と同じ形）。
  if (!session?.user?.id) {
    redirect('/403')
  }
  // guest-role AC-9: ゲストはホームへ入れない（許可リストに `/dashboard` が
  // 無い）。middleware の早期ゲート（Edge・token.role は降格直後 stale に
  // なりうる）に加えた Node 側の実防御。requirements R2。
  if (isGuestRole(session.user.role)) {
    redirect('/403')
  }
  const viewerUserId = session.user.id

  // JST today。events の日付列は YYYY-MM-DD なので辞書順比較で正しい。
  // クライアントへ渡して共有する（クライアントで Date.now() を呼ぶと
  // hydration mismatch になる）。
  const todayStr = todayInJst()

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
        gte(events.eventDate, todayStr),
        ne(events.status, 'cancelled'),
        eq(events.kind, 'individual'),
      ),
    )

  // 母集団が空なら出場予定もアラートも空。以降のクエリを投げる意味がない
  // （inArray に空配列を渡さないためのガードも兼ねる）。
  if (eventRows.length === 0) {
    return (
      <div className="p-4">
        <HomeTimeline
          data={{ todayStr, viewerUserId, today: [], upcoming: [], alerts: [] }}
        />
      </div>
    )
  }

  const eventIds = eventRows.map((e) => e.id)
  const groupIds = [...new Set(eventRows.map((e) => e.entryGroupId))]

  // ② 出欠。**attend では絞らない** — 希望パスの出場者（attend=true）と、未回答
  //    アラートの「自分の行が無い」判定の両方に要るため。ここで attend=true に
  //    絞ると、既に「不参加」と答えた人にアラートが鳴り続ける。
  const attendanceRows = await db
    .select({
      eventId: eventAttendances.eventId,
      userId: eventAttendances.userId,
      attend: eventAttendances.attend,
    })
    .from(eventAttendances)
    .where(inArray(eventAttendances.eventId, eventIds))

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
      grade: users.grade,
      role: users.role,
    })
    .from(users)
    .where(eq(users.isInvited, true))
  const invitedUserById = new Map(invitedUsers.map((u) => [u.id, u]))

  // ⑥ 閲覧者の級と招待状態（未回答アラートの対象判定用）。招待済みとは限らない
  //    （管理者など）ので invitedUsers からは引かない。
  const viewer = await db.query.users.findFirst({
    columns: { grade: true, isInvited: true },
    where: eq(users.id, viewerUserId),
  })
  const viewerGrade = viewer?.grade ?? null

  // アラートは「自分が手を動かす必要がある」状態表示なので、**回答できる人にだけ**
  // 出す。一般会員は `is_invited` が必須（Auth.js の signIn は連携済みの既存ユーザーを
  // 招待ゲート無しで通すため、`is_invited=false` のログインセッションは実在する）。
  // 管理者・副管理者はこのゲートをバイパスする —— `/events/[id]` の `canRespond` と
  // `submitAttendance` の判定に合わせる（ここだけ緩いと、タップしても回答できない
  // アラートが出る）。
  const viewerIsAdmin =
    session.user.role === 'admin' || session.user.role === 'vice_admin'
  const viewerCanRespond = viewerIsAdmin || viewer?.isInvited === true

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
  function confirmedEntrantsOf(entryGroupId: number): HomeEntrant[] {
    // 同一グループに非 superseded な確定名簿が複数ある異常系でも二重に出さない。
    const byUserId = new Map<string, HomeEntrant>()
    for (const rosterId of rosterIdsByGroup.get(entryGroupId) ?? []) {
      for (const row of rosterEntriesByRosterId.get(rosterId) ?? []) {
        if (row.userId == null || byUserId.has(row.userId)) continue
        byUserId.set(row.userId, {
          userId: row.userId,
          surname: surname(row.userName),
          // その大会で出る級。名簿行に級が無いときだけ現在の級へ落とす。
          grade: row.entryGrade ?? row.userGrade,
          // guest-role: 確定名簿の行は常に「会員として同定できた」ゲート
          // （innerJoin）を通っているので、ここに現れるのは会員だけ。
          // ゲストは名簿に構造的に載らない（requirements §7）。
          isGuest: false,
        })
      }
    }
    return sortEntrants([...byUserId.values()])
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
  ): HomeEntrant[] {
    const entrants = (attendancesByEvent.get(eventId) ?? []).flatMap((a) => {
      if (!a.attend) return []
      const user = invitedUserById.get(a.userId)
      if (!user || !isEligibleGrade(eligibleGrades, user.grade)) return []
      const isGuest = isGuestRole(user.role)
      if (guestsOnly && !isGuest) return []
      return [
        { userId: user.id, surname: surname(user.name), grade: user.grade, isGuest },
      ]
    })
    return sortEntrants(entrants)
  }

  /** 確定名簿が無いイベントの出場者（希望パス）。会員・ゲストを区別せず拾う。 */
  function hopedEntrantsOf(
    eventId: number,
    eligibleGrades: Grade[] | null,
  ): HomeEntrant[] {
    return entrantsFromAttendance(eventId, eligibleGrades, { guestsOnly: false })
  }

  const timelineEvents: HomeTimelineEvent[] = []
  for (const e of eventRows) {
    // 確定名簿があるグループは確定パス。無ければ出欠（希望）へフォールバックする。
    const hasConfirmedRoster = (rosterIdsByGroup.get(e.entryGroupId) ?? []).length > 0
    const entrants = hasConfirmedRoster
      ? // guest-role AC-22: 確定パスでも、名簿には構造的に載らないゲストを
        // 出欠回答から合流させる（会員は名簿ベースのまま。上の
        // entrantsFromAttendance の doc コメントが理由の正典）。
        sortEntrants([
          ...confirmedEntrantsOf(e.entryGroupId),
          ...entrantsFromAttendance(e.id, e.eligibleGrades, { guestsOnly: true }),
        ])
      : hopedEntrantsOf(e.id, e.eligibleGrades)

    // 出場者 0 名の大会はホームに載せない（design-spec §6）。
    if (entrants.length === 0) continue

    timelineEvents.push({
      eventId: e.id,
      displayName: displayName(e),
      eventDate: e.eventDate,
      venue: e.location,
      confidence: hasConfirmedRoster ? 'confirmed' : 'hoped',
      entrants,
    })
  }

  timelineEvents.sort(
    (a, b) => cmp(a.eventDate, b.eventDate) || a.eventId - b.eventId,
  )
  const today = timelineEvents.filter((e) => e.eventDate === todayStr)
  const upcoming = timelineEvents.filter((e) => e.eventDate > todayStr)

  // --- 未回答アラート -------------------------------------------------------

  // 母集団は①そのもの（出場者 0 名で落とした大会も対象）—— 誰も答えていない大会
  // こそ自分の回答が要る。回答済み（attend の値は問わない）の大会は出さない。
  const answeredEventIds = new Set(
    attendanceRows.filter((a) => a.userId === viewerUserId).map((a) => a.eventId),
  )
  const alerts: HomeUnansweredAlert[] = (viewerCanRespond ? eventRows : [])
    .flatMap((e) => {
      if (!isEligibleGrade(e.eligibleGrades, viewerGrade)) return []
      if (answeredEventIds.has(e.id)) return []
      const baseDeadline = e.internalDeadline ?? e.entryDeadline
      if (baseDeadline == null) return []
      const daysLeft = diffDays(todayStr, baseDeadline)
      // 締切超過（負値）は出さない —— ホームのアラートは「まだ間に合う」ものだけ。
      // 超過分の督促は entry-overdue-alert（管理者への LINE 通知）が担う。
      if (!Number.isFinite(daysLeft) || daysLeft < 0 || daysLeft > ALERT_WINDOW_DAYS) {
        return []
      }
      return [
        { eventId: e.id, displayName: displayName(e), baseDeadline, daysLeft },
      ]
    })
    .sort((a, b) => cmp(a.baseDeadline, b.baseDeadline) || a.eventId - b.eventId)

  const data: HomeTimelineData = {
    todayStr,
    viewerUserId,
    today,
    upcoming,
    alerts,
  }

  // ページ余白 16px はこの根要素が持つ（nav-settings-hub AC-16b。共通シェルの
  // `<main>` にも HomeTimeline にも足さない。`page-padding.test.ts` が固定）。
  return (
    <div className="p-4">
      <HomeTimeline data={data} />
    </div>
  )
}
