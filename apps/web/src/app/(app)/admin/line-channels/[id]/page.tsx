import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Btn, Card, DescList, Pill, type PillTone } from '@/components/ui'
import {
  ManualLinkModal,
  type LinkableEventOption,
} from '@/components/admin/ManualLinkModal'
import {
  disableChannel,
  enableChannel,
  manualLinkGroup,
  releaseChannel,
} from '../actions'
import {
  eventLineBroadcasts,
  events,
  lineChannels,
} from '@kagetra/shared/schema'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  available: { label: '空き', tone: 'success' },
  assigned: { label: '招待コード発行中', tone: 'info' },
  active: { label: '配信中', tone: 'brand' },
  system: { label: 'システム通知', tone: 'warn' },
  disabled: { label: '無効化', tone: 'danger' },
}

const BROADCAST_STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  invite_pending: { label: '招待コード待ち', tone: 'info' },
  joined_waiting_code: { label: 'Bot 入室済み（コード待ち）', tone: 'info' },
  linked: { label: '配信中', tone: 'brand' },
  revoked: { label: '解除', tone: 'neutral' },
  released: { label: '解放済み', tone: 'neutral' },
}

interface PageProps {
  params: Promise<{ id: string }>
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Mask the LINE group ID — operators have legitimate reason to see the
 * tail (it's how they verify they're looking at the right group in the
 * LINE app), but the prefix is sensitive enough that we don't print it
 * in full. Same convention used in the events/[id] LINE broadcast section.
 */
function maskGroupId(raw: string | null | undefined): string {
  if (!raw) return '—'
  if (raw.length <= 8) return raw
  return `…${raw.slice(-8)}`
}

export default async function LineChannelDetailPage({ params }: PageProps) {
  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const { id: rawId } = await params
  const channelId = Number.parseInt(rawId, 10)
  if (!Number.isFinite(channelId)) notFound()

  const channel = await db.query.lineChannels.findFirst({
    where: eq(lineChannels.id, channelId),
  })
  if (!channel) notFound()
  if (channel.purpose !== 'event_broadcast') {
    // The detail page is wired for the broadcast pool only; system_notify
    // ops live in a different (future) screen. Redirect rather than 404 so
    // operators following a stale link land somewhere meaningful.
    redirect('/admin/line-channels')
  }

  const broadcastHistory = await db
    .select({
      id: eventLineBroadcasts.id,
      status: eventLineBroadcasts.status,
      eventId: eventLineBroadcasts.eventId,
      eventTitle: events.title,
      eventDate: events.eventDate,
      lineGroupId: eventLineBroadcasts.lineGroupId,
      linkedAt: eventLineBroadcasts.linkedAt,
      releasedAt: eventLineBroadcasts.releasedAt,
      revokedAt: eventLineBroadcasts.revokedAt,
      revokeReason: eventLineBroadcasts.revokeReason,
      createdAt: eventLineBroadcasts.createdAt,
    })
    .from(eventLineBroadcasts)
    .leftJoin(events, eq(events.id, eventLineBroadcasts.eventId))
    .where(eq(eventLineBroadcasts.lineChannelId, channelId))
    .orderBy(desc(eventLineBroadcasts.createdAt))
    .limit(20)

  const currentBinding =
    broadcastHistory.find((row) =>
      ['invite_pending', 'joined_waiting_code', 'linked'].includes(row.status),
    ) ?? null

  // Manual-link target list: future events (date >= today) that don't yet
  // have a non-terminal broadcast binding. Operators rarely retro-link an
  // event whose date has passed, and limiting the list keeps the modal
  // snappy.
  const today = new Date().toISOString().slice(0, 10)
  const linkedEventIds = await db
    .select({ id: eventLineBroadcasts.eventId })
    .from(eventLineBroadcasts)
    .where(
      sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
    )
  const blockedIds = linkedEventIds
    .map((row) => row.id)
    .filter((id) => id !== currentBinding?.eventId)
  const linkableEventsQuery = blockedIds.length > 0
    ? db
        .select({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
        })
        .from(events)
        .where(
          sql`${events.eventDate} >= ${today} AND ${events.id} NOT IN ${blockedIds}`,
        )
        .orderBy(asc(events.eventDate))
        .limit(50)
    : db
        .select({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
        })
        .from(events)
        .where(sql`${events.eventDate} >= ${today}`)
        .orderBy(asc(events.eventDate))
        .limit(50)

  const linkableEvents: LinkableEventOption[] = await linkableEventsQuery

  const statusLabel = STATUS_LABEL[channel.status] ?? {
    label: channel.status,
    tone: 'neutral' as const,
  }

  async function handleReleaseAction() {
    'use server'
    await releaseChannel(channelId)
  }
  async function handleDisableAction() {
    'use server'
    await disableChannel(channelId)
  }
  async function handleEnableAction() {
    'use server'
    await enableChannel(channelId)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <nav className="text-xs text-ink-meta">
        <Link href="/admin/line-channels" className="hover:text-brand">
          ← Bot 一覧へ戻る
        </Link>
      </nav>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-ink-1">
            {channel.note ?? channel.botId}
          </h1>
          <p className="text-[11px] text-ink-meta">id: {channel.id}</p>
        </div>
        <Pill tone={statusLabel.tone} size="md">
          {statusLabel.label}
        </Pill>
      </header>

      <Card className="p-4">
        <DescList
          items={[
            { label: 'Bot ID', value: channel.botId },
            { label: 'チャネル ID', value: channel.channelId },
            {
              label: '紐付け中の大会',
              value: currentBinding?.eventId ? (
                <Link
                  href={`/events/${currentBinding.eventId}`}
                  className="text-brand hover:underline"
                >
                  {currentBinding.eventTitle ?? `#${currentBinding.eventId}`}
                </Link>
              ) : (
                '—'
              ),
            },
            {
              label: 'LINE グループ ID',
              value: maskGroupId(currentBinding?.lineGroupId ?? null),
            },
            {
              label: '紐付け日時',
              value: formatDateTime(currentBinding?.linkedAt ?? null),
            },
            {
              label: '更新日時',
              value: formatDateTime(channel.updatedAt),
            },
          ]}
        />
      </Card>

      <div className="flex flex-wrap gap-2">
        {channel.assignedEventId != null || channel.status === 'active' ? (
          <form action={handleReleaseAction}>
            <Btn type="submit" kind="danger" size="sm">
              強制解放
            </Btn>
          </form>
        ) : null}
        {channel.status !== 'disabled' &&
        channel.assignedEventId == null &&
        channel.status !== 'active' ? (
          <form action={handleDisableAction}>
            <Btn type="submit" kind="secondary" size="sm">
              無効化
            </Btn>
          </form>
        ) : null}
        {channel.status === 'disabled' ? (
          <form action={handleEnableAction}>
            <Btn type="submit" kind="primary" size="sm">
              有効化
            </Btn>
          </form>
        ) : null}
        {channel.status !== 'disabled' ? (
          <ManualLinkModal
            channelId={channel.id}
            channelLabel={channel.note ?? channel.botId}
            candidateEvents={linkableEvents}
            action={manualLinkGroup}
          />
        ) : null}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-1">紐付け履歴</h2>
        {broadcastHistory.length === 0 ? (
          <Card className="px-3 py-6">
            <p className="text-xs text-ink-meta text-center">
              この Bot はまだ大会に紐付けられたことがありません。
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border/60">
              {broadcastHistory.map((row) => {
                const stat = BROADCAST_STATUS_LABEL[row.status] ?? {
                  label: row.status,
                  tone: 'neutral' as const,
                }
                return (
                  <li key={row.id} className="px-3 py-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-ink-1 truncate">
                        {row.eventId ? (
                          <Link
                            href={`/events/${row.eventId}`}
                            className="hover:underline"
                          >
                            {row.eventTitle ?? `#${row.eventId}`}
                          </Link>
                        ) : (
                          <span>{row.eventTitle ?? '—'}</span>
                        )}
                      </div>
                      <Pill tone={stat.tone} size="sm">
                        {stat.label}
                      </Pill>
                    </div>
                    <div className="text-[10px] text-ink-meta tabular-nums flex flex-wrap gap-x-3 gap-y-1">
                      <span>発行: {formatDateTime(row.createdAt)}</span>
                      <span>連携: {formatDateTime(row.linkedAt)}</span>
                      <span>解除: {formatDateTime(row.revokedAt)}</span>
                      <span>解放: {formatDateTime(row.releasedAt)}</span>
                      {row.revokeReason ? (
                        <span>事由: {row.revokeReason}</span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}
