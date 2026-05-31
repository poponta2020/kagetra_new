import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, eq, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { addDays, diffDays, todayInJst } from '@/lib/jst-date'
import { Card, Pill } from '@/components/ui'
import {
  LineChannelTable,
  type LineChannelRow,
} from '@/components/admin/LineChannelTable'
import { lineChannels, events, eventLineBroadcasts } from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

const FILTERABLE_STATUSES = ['available', 'assigned', 'active', 'disabled'] as const
type FilterableStatus = (typeof FILTERABLE_STATUSES)[number]

const FILTER_LABEL: Record<FilterableStatus | 'all', string> = {
  all: 'すべて',
  available: '空き',
  assigned: '招待コード発行中',
  active: '配信中',
  disabled: '無効化',
}

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

function normaliseFilter(raw: string | undefined): FilterableStatus | 'all' {
  if (!raw) return 'all'
  if ((FILTERABLE_STATUSES as readonly string[]).includes(raw)) {
    return raw as FilterableStatus
  }
  return 'all'
}

function computeReleaseInDays(
  eventDate: string | null,
  extendedUntil: string | null,
): number | null {
  if (!eventDate) return null
  // r-final-19 should_fix: release-expired ジョブは JST `YYYY-MM-DD` で
  // 判定するため、画面の残日数も同じ基準で算出する。`Date.now()` /
  // UTC ベースだと JST 深夜帯で 1 日ズレる。`diffDays` は JST 日付
  // 文字列同士の差分をそのまま日数で返す。
  // - extendedUntil があれば: その日付 - 今日 (JST)
  // - なければ: event_date + 30 - 今日 (JST)
  const today = todayInJst()
  const cutoff = extendedUntil ?? addDays(eventDate, 30)
  const days = diffDays(today, cutoff)
  return Number.isNaN(days) ? null : days
}

export default async function LineChannelsAdminPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const { status: statusRaw } = await searchParams
  const filter = normaliseFilter(statusRaw)

  // Pull every broadcast Bot (purpose='event_broadcast') in note-asc order so
  // kagetra-event-bot-1 .. -30 list in human order. The system_notify row is
  // intentionally hidden — it has its own lifecycle.
  const rawRows = await db
    .select({
      id: lineChannels.id,
      botId: lineChannels.botId,
      note: lineChannels.note,
      status: lineChannels.status,
      assignedEventId: lineChannels.assignedEventId,
      eventTitle: events.title,
      eventDate: events.eventDate,
      extendedUntil: eventLineBroadcasts.extendedUntil,
    })
    .from(lineChannels)
    .leftJoin(events, eq(events.id, lineChannels.assignedEventId))
    // r-final-5 should_fix: eventId だけで JOIN すると同じ event に対する
    // 過去 revoked/released 行を一緒に拾い、Bot 一覧で同じ Bot が複数行に
    // 表示される。lineChannelId + active 系 status まで条件に入れ、
    // 「この Bot の現在 active な binding」だけを LEFT JOIN するように絞る。
    .leftJoin(
      eventLineBroadcasts,
      and(
        eq(eventLineBroadcasts.eventId, lineChannels.assignedEventId),
        eq(eventLineBroadcasts.lineChannelId, lineChannels.id),
        sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
      ),
    )
    .where(eq(lineChannels.purpose, 'event_broadcast'))
    .orderBy(asc(lineChannels.note), asc(lineChannels.id))

  const filtered = filter === 'all'
    ? rawRows
    : rawRows.filter((row) => row.status === filter)

  const tableRows: LineChannelRow[] = filtered.map((row) => ({
    id: row.id,
    botId: row.botId,
    note: row.note,
    // The system_notify row is excluded above, so the cast is safe — but a
    // pool member can still be `system` in theory if an operator promoted it
    // manually. The table component renders that gracefully.
    status: row.status,
    assignedEvent:
      row.assignedEventId && row.eventTitle && row.eventDate
        ? {
            id: row.assignedEventId,
            title: row.eventTitle,
            eventDate: row.eventDate,
          }
        : null,
    releaseInDays:
      row.assignedEventId && row.eventDate
        ? computeReleaseInDays(row.eventDate, row.extendedUntil)
        : null,
  }))

  // The 30-Bot pool alarm: 25 of 30 active means we're one tournament away
  // from refusing new invite codes. Surface it before the table so operators
  // can act before they hit the "Bot プール枯渇" error in the events flow.
  const activeCount = rawRows.filter((row) => row.status === 'active').length
  const totalCount = rawRows.length
  const showPoolAlert = totalCount > 0 && activeCount >= Math.ceil(totalCount * (25 / 30))

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink-1">LINE 配信 Bot 管理</h1>
        <span className="text-xs text-ink-meta tabular-nums">
          {activeCount} / {totalCount} 稼働中
        </span>
      </header>

      {showPoolAlert ? (
        <Card className="px-3 py-2 flex items-center gap-2 bg-warn-bg/40 border-warn-fg/30">
          <Pill tone="warn" size="sm">
            注意
          </Pill>
          <span className="text-xs text-ink-2">
            Bot プールが残り少なくなっています。終了した大会の Bot を解放してください。
          </span>
        </Card>
      ) : null}

      <nav
        aria-label="ステータスでフィルタ"
        className="flex flex-wrap gap-2 text-xs"
      >
        {(['all', ...FILTERABLE_STATUSES] as const).map((key) => {
          const active = filter === key
          const href = key === 'all'
            ? '/admin/line-channels'
            : `/admin/line-channels?status=${key}`
          return (
            <Link
              key={key}
              href={href}
              className={
                active
                  ? 'px-3 py-1 rounded-full bg-brand text-white'
                  : 'px-3 py-1 rounded-full border border-border text-ink-2 hover:bg-surface-alt'
              }
            >
              {FILTER_LABEL[key]}
            </Link>
          )
        })}
      </nav>

      <Card className="overflow-hidden">
        <LineChannelTable rows={tableRows} />
      </Card>

      <p className="text-[11px] text-ink-meta">
        全 {totalCount} Bot 中 {tableRows.length} 件を表示しています。
      </p>
    </div>
  )
}
