import Link from 'next/link'
import { db } from '@/lib/db'
import { events, eventAttendances } from '@kagetra/shared/schema'
import { and, asc, eq, gte, inArray, isNotNull, lt, ne } from 'drizzle-orm'
import { Card, Pill, StatusPill } from '@/components/ui'
import { formatFlowDate } from '@/lib/event-date'
import { isPastDeadline } from '../events/event-list-utils'

/**
 * 「申込者なしで締切済の大会」（events-no-entrants）。
 *
 * `/events` は `isRowVisible` で「会内締切超過 かつ 自分が attend=true でない」
 * 行を隠すため、**参加者が 1 人もいなかった大会は全会員から消える**。開催日が
 * 来るまでは `/events-archive`（`eventDate < today`）にも出ないので、締切から
 * 開催日までの間どこからも辿れない。その窓を埋めるのがこのページ
 * （docs/features/events-no-entrants/requirements.md §1・§3.2）。
 *
 * 掲載条件（全会員に同じ一覧を見せる＝閲覧者で変わらない）:
 *   1. `eventDate >= 今日`（過去は `/events-archive` の担当。二重掲載しない）
 *   2. 会内締切が過去（未設定・当日は対象外）
 *   3. `attend=true` が 0 名（「出欠行が無い」ではない。全員が不参加と答えた
 *      大会も 0 名として載せる）
 *   4. `entry_status <> 'not_applying'`（管理者が明示的に見送った大会は
 *      申込管理側で可視化済みなので載せない）
 */
export default async function EventsNoEntrantsPage() {
  // JST today; events.eventDate / internalDeadline are YYYY-MM-DD so
  // lexicographic compare is correct.
  const todayStr = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })

  // SQL は候補を粗く絞る**前段フィルタ**で、掲載可否の確定は取得後の
  // `isPastDeadline` だけが決める（しきい値ロジックの唯一の真実は
  // `formatDeadlineCountdown` の past tone。判定ロジックを SQL へ書き写さない）。
  // ⚠️ 前段が `isPastDeadline` より広いか等しいことに依存する 2 段構え。
  // `isPastDeadline` の境界（締切当日の扱い等）を変えるときは、SQL 側が先に行を
  // 落とさないか必ず併せて見直すこと（requirements.md §6）。母集団は開催日以降の
  // 大会だけなので高々数十件で、`/events` と同じ取り方。
  const candidates = await db.query.events.findMany({
    where: and(
      gte(events.eventDate, todayStr),
      isNotNull(events.internalDeadline),
      lt(events.internalDeadline, todayStr),
      ne(events.entryStatus, 'not_applying'),
    ),
    orderBy: [asc(events.eventDate), asc(events.id)],
  })
  const pastDeadline = candidates.filter((e) =>
    isPastDeadline(e.internalDeadline, todayStr),
  )

  // 参加者 0 名の判定。候補 ID にスコープした集計 1 クエリを取り（N+1 回避・
  // event_attendances の全走査も回避）、**集計結果に現れない ID** を 0 名と
  // する。人数のセマンティクスは `/events`・`/events-archive` と同じ
  // attend=true 件数（ゲストの回答も含む）。
  const candidateIds = pastDeadline.map((e) => e.id)
  const withEntrants =
    candidateIds.length === 0
      ? []
      : await db
          .selectDistinct({ eventId: eventAttendances.eventId })
          .from(eventAttendances)
          .where(
            and(
              inArray(eventAttendances.eventId, candidateIds),
              eq(eventAttendances.attend, true),
            ),
          )
  const withEntrantIds = new Set(withEntrants.map((r) => r.eventId))
  const eventList = pastDeadline.filter((e) => !withEntrantIds.has(e.id))

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold text-ink">
          申込者なしで締切済の大会
        </h1>
        <Link href="/events" className="shrink-0 text-sm text-brand">
          現在の大会 →
        </Link>
      </div>
      {eventList.length === 0 ? (
        <Card>
          <div className="text-center text-ink-meta py-6">
            申込者なしで締切済の大会はありません
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {eventList.map((event) => (
            <Link key={event.id} href={`/events/${event.id}`} className="block">
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink truncate">
                        {event.title}
                      </span>
                      {event.official && (
                        <Pill tone="success" size="sm">
                          公認
                        </Pill>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ink-meta">
                      {event.eventDate}
                    </div>
                    {event.location && (
                      <div className="mt-0.5 text-xs text-ink-meta">
                        {event.location}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusPill status={event.status} size="sm" />
                    {/* 掲載対象は定義上つねに参加 0 名なので「参加 0名」は
                        情報量がゼロ。掲載理由である締切日を出す（§3.3）。 */}
                    <span className="text-xs text-ink-meta whitespace-nowrap">
                      会内締切 {formatFlowDate(event.internalDeadline)}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
