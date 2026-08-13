import { redirect } from 'next/navigation'
import { and, eq, inArray } from 'drizzle-orm'
import type { Grade } from '@kagetra/shared/types'
import { eventAttendances, users } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isGuestRole } from '@/lib/guest-access'
import { diffDays, todayInJst } from '@/lib/jst-date'
import { surname } from '@/lib/surname'
import { getUpcomingEntrants, type UpcomingEntrant } from '@/lib/upcoming-entrants'
// 表示名（通称 + 対象級）の導出は `/admin/entries` の純関数が唯一の実装なので
// 再実装しない（design-spec §6「大会表示名」）。引数は `NameSource`（title /
// shortName / eligibleGrades だけの構造型）なので、getUpcomingEntrants が返す
// イベント行をそのまま渡せる。
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

/**
 * 対象級判定。空/null の `eligible_grades` は「全員が対象」（イベント詳細と同じ）。
 * `upcoming-entrants.ts` にも同名の私的関数がある —— こちらは未回答アラートの
 * 「閲覧者の級」判定という表示側の関心なので、あえて別に持つ（結合させない）。
 */
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
 * `upcoming-entrants.ts` の DTO をホーム表示用の {@link HomeEntrant} へ変換する。
 * チップの級は `entryGrade ?? userGrade`（名簿行の級を優先し、無ければ現在の級）。
 */
function toHomeEntrant(e: UpcomingEntrant): HomeEntrant {
  return {
    userId: e.userId,
    surname: surname(e.name),
    grade: e.entryGrade ?? e.userGrade,
    isGuest: e.isGuest,
  }
}

/**
 * ホーム（`/dashboard`）= 会の出場予定。
 *
 * サーバー側の仕事は {@link HomeTimelineData} を組むことだけで、表示は
 * HomeTimeline.tsx が全部持つ。母集団・絞り込みの規約は home-timeline-types.ts の
 * doc コメントが正典（design-spec §6）。あいさつ・権限カードは撤去した。
 *
 * 出場者の導出（母集団・確定/希望・ゲスト合流）は `@/lib/upcoming-entrants` へ
 * 切り出し済み（外部向け出場者 API と共有するため）。ここに残るのは、閲覧者
 * スコープの未回答アラートと表示の組み立てだけ。
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

  const upcomingEvents = await getUpcomingEntrants({ since: todayStr })

  // 母集団が空なら出場予定もアラートも空。以降のクエリを投げる意味がない。
  if (upcomingEvents.length === 0) {
    return (
      <div className="p-4">
        <HomeTimeline
          data={{ todayStr, viewerUserId, today: [], upcoming: [], alerts: [] }}
        />
      </div>
    )
  }

  const eventIds = upcomingEvents.map((e) => e.id)

  // 未回答アラート用: 閲覧者自身の出欠行。**attend では絞らない** ——
  // 「不参加」と答えた大会も回答済み扱いにするため（既に答えた人にアラートを
  // 鳴らし続けない）。母集団は upcomingEvents そのもの（出場者 0 名のイベントも
  // 含む）なので、旧実装の attendanceRows ベースの answeredEventIds と等価。
  const viewerAttendanceRows = await db
    .select({ eventId: eventAttendances.eventId })
    .from(eventAttendances)
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.userId, viewerUserId),
      ),
    )
  const answeredEventIds = new Set(viewerAttendanceRows.map((a) => a.eventId))

  // 閲覧者の級と招待状態（未回答アラートの対象判定用）。招待済みとは限らない
  // （管理者など）ので getUpcomingEntrants の招待済み集合からは引かない。
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

  // --- 出場者の組み立て -----------------------------------------------------

  const timelineEvents: HomeTimelineEvent[] = []
  for (const e of upcomingEvents) {
    const entrants = sortEntrants(e.entrants.map(toHomeEntrant))

    // 出場者 0 名の大会はホームに載せない（design-spec §6）。
    if (entrants.length === 0) continue

    timelineEvents.push({
      eventId: e.id,
      displayName: displayName(e),
      eventDate: e.eventDate,
      venue: e.location,
      confidence: e.hasConfirmedRoster ? 'confirmed' : 'hoped',
      entrants,
    })
  }

  timelineEvents.sort(
    (a, b) => cmp(a.eventDate, b.eventDate) || a.eventId - b.eventId,
  )
  const today = timelineEvents.filter((e) => e.eventDate === todayStr)
  const upcoming = timelineEvents.filter((e) => e.eventDate > todayStr)

  // --- 未回答アラート -------------------------------------------------------

  // 母集団は upcomingEvents そのもの（出場者 0 名で落とした大会も対象）——
  // 誰も答えていない大会こそ自分の回答が要る。回答済み（attend の値は問わない）の
  // 大会は出さない。
  const alerts: HomeUnansweredAlert[] = (viewerCanRespond ? upcomingEvents : [])
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
