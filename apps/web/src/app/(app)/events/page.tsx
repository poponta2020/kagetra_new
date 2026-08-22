import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances, users } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { and, asc, eq, gte, inArray, ne } from 'drizzle-orm'
import { auth } from '@/auth'
import { isGuestRole } from '@/lib/guest-access'
import { surname } from '@/lib/surname'
import { EventListClient } from './EventListClient'
import { isGradeEligible, type EventListItem } from './event-list-utils'

// Btn primary mirrored as a Link className since wrapping <Link> in <Btn>
// would nest it inside a <button>.
const NEW_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors h-8 px-3 text-xs bg-brand text-ink-on-brand hover:bg-brand-hover'

export default async function EventsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'vice_admin'
  // events-no-entrants §3.5: 「申込者なしで締切済 →」の行き先はゲストに
  // 開いていない（`isGuestAllowedPath` の許可リストに載せない＝middleware が
  // /403 へ飛ばす）。403 へ飛ぶ導線を見せないよう、リンク自体を描画しない。
  const isGuest = isGuestRole(session?.user.role)

  // JST today; events.eventDate is YYYY-MM-DD so lexicographic compare is correct.
  // Past events are surfaced on /events-archive — listing them here too would double-list.
  const todayStr = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })

  // Fetch event list first so the attendance join can be scoped to the visible
  // IDs — otherwise we'd scan every row in event_attendances, including rows for
  // archived events rendered on /events-archive. id is a stable secondary sort.
  // 「申し込まない」（entry_status='not_applying'）は一覧から除外する。
  // 取得後フィルタではなくクエリ条件にする（件数表示・フィルタ・並び替えの
  // 母集団を揃えるため）。entryStatus は NOT NULL なので ne() で NULL 行が
  // 落ちる心配はない。/events-archive は変更しない（開催日経過後は従来どおり出す）。
  const eventList = await db.query.events.findMany({
    where: and(gte(events.eventDate, todayStr), ne(events.entryStatus, 'not_applying')),
    orderBy: [asc(events.eventDate), asc(events.id)],
  })
  const visibleEventIds = eventList.map((e) => e.id)

  // ⑧ 参加者名: attend=true を users 結合で表示中イベントぶん 1 クエリ取得（N+1 回避）。
  // 集計セマンティクスは現行と同じ attend=true 件数（詳細画面の eligible 絞り込みとは別）。
  const participantRows =
    visibleEventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventAttendances.eventId,
            userId: eventAttendances.userId,
            name: users.name,
            grade: users.grade,
          })
          .from(eventAttendances)
          .innerJoin(users, eq(users.id, eventAttendances.userId))
          .where(
            and(
              inArray(eventAttendances.eventId, visibleEventIds),
              eq(eventAttendances.attend, true),
            ),
          )

  // イベント別にまとめ、級昇順（未設定は末尾）で並べる（詳細画面の参加者表示に合わせる）。
  // userId も保持しておき、後段で「自分が attend=true か」を追加クエリなしで判定する。
  const participantsByEvent = new Map<
    number,
    Array<{ userId: string; name: string | null; grade: Grade | null }>
  >()
  for (const row of participantRows) {
    const list = participantsByEvent.get(row.eventId)
    if (list) list.push(row)
    else participantsByEvent.set(row.eventId, [row])
  }
  for (const list of participantsByEvent.values()) {
    list.sort((a, b) => (a.grade ?? 'Z').localeCompare(b.grade ?? 'Z'))
  }

  // ⑦ 申込可能判定は「自分の級」で行う（管理者バイパスなし）。級のみ取得。
  let myGrade: Grade | null = null
  if (session?.user.id) {
    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { grade: true },
    })
    myGrade = me?.grade ?? null
  }

  // クライアントへ渡す最小データ。location/official/eligibleGrades/grade はカードに
  // 渡さず、①⑤は表示から落とし、⑦は canApply に畳む。userId はサーバー内の
  // viewerAttending 判定にのみ使い、items には含めない（個人情報は苗字のみ渡す）。
  const viewerId = session?.user.id
  const items: EventListItem[] = eventList.map((e) => {
    const parts = participantsByEvent.get(e.id) ?? []
    return {
      id: e.id,
      title: e.title,
      eventDate: e.eventDate,
      internalDeadline: e.internalDeadline,
      status: e.status,
      canApply: isGradeEligible(e.eligibleGrades, myGrade),
      attendCount: parts.length,
      attendeeSurnames: parts.map((p) => surname(p.name)),
      viewerAttending: viewerId != null && parts.some((p) => p.userId === viewerId),
    }
  })

  // event-list-month-grouping §2-5: ページ見出し行（h1・リンク・新規作成）は
  // 削除し、「過去の大会 →」と「新規作成」はリスト末尾のフッター行へ移す。
  // フッターはクライアント側ではなくここに置く: ソートにも 0 件表示にも
  // 左右されず必ず出す必要がある（§2-7・§5「ナビゲーション欠落なし」）。
  // events-no-entrants §3.1: 2 段目に「申込者なしで締切済 →」を足す。締切超過で
  // この一覧から消えた（＝申込者 0 名の）大会を辿れる唯一の導線。
  return (
    <div className="flex flex-col gap-4 p-4">
      <EventListClient items={items} todayStr={todayStr} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Link href="/events-archive" className="text-sm text-brand">
            過去の大会 →
          </Link>
          {isAdmin && (
            <Link href="/events/new" className={NEW_LINK_CLASS}>
              新規作成
            </Link>
          )}
        </div>
        {!isGuest && (
          <Link href="/events-no-entrants" className="text-sm text-brand">
            申込者なしで締切済 →
          </Link>
        )}
      </div>
    </div>
  )
}
