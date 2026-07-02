'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, StatusPill } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  formatDeadlineCountdown,
  formatEventDate,
  sortEvents,
  type DeadlineTone,
  type EventListItem,
  type SortAxis,
} from './event-list-utils'

/**
 * 大会申込（`/events`）一覧のクライアント本体（design-spec B案・区切り線リスト）。
 *
 * サーバーが畳んだ最小データ（EventListItem[]）＋JST `todayStr` を受け取り、
 * 「フィルタ（申込可能のみ）→ ソート（締切日順/開催日順）」して描画する。
 * `Date.now()` は呼ばず `todayStr` を使う＝hydration mismatch を避ける。
 * ソート/フィルタ状態は画面内のみ（永続化しない・再訪で既定に戻る）。
 */
export function EventListClient({
  items,
  todayStr,
}: {
  items: EventListItem[]
  todayStr: string
}) {
  const [sort, setSort] = useState<SortAxis>('deadline')
  const [applicableOnly, setApplicableOnly] = useState(false)

  // 全体 0 件：コントロールを出さず現状文言（＝未来イベント無し）。
  if (items.length === 0) {
    return (
      <Card>
        <div className="text-center text-ink-meta py-6">
          現在のイベントはありません
        </div>
      </Card>
    )
  }

  const filtered = applicableOnly ? items.filter((e) => e.canApply) : items
  const rows = sortEvents(filtered, sort)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="並び替え"
          className="flex items-stretch rounded-full border border-border bg-surface p-0.5 text-[13px]"
        >
          <SortTab
            active={sort === 'date'}
            label="開催日順"
            onClick={() => setSort('date')}
          />
          <SortTab
            active={sort === 'deadline'}
            label="締切日順"
            onClick={() => setSort('deadline')}
          />
        </div>

        <label className="flex shrink-0 items-center gap-2">
          <span className="text-[13px] text-ink-meta">申込可能のみ</span>
          <button
            type="button"
            role="switch"
            aria-checked={applicableOnly}
            aria-label="申込可能のみ"
            onClick={() => setApplicableOnly((v) => !v)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              applicableOnly ? 'bg-brand' : 'bg-neutral-bg',
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                applicableOnly ? 'translate-x-[22px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </label>
      </div>

      {rows.length === 0 ? (
        <Card>
          <div className="text-center text-ink-meta py-6">
            申込可能な大会はありません
          </div>
        </Card>
      ) : (
        <ul className="divide-y divide-border-soft border-y border-border-soft">
          {rows.map((event) => (
            <li key={event.id}>
              <EventRow event={event} todayStr={todayStr} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SortTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition-colors',
        active ? 'bg-brand text-white' : 'text-ink-meta hover:bg-surface-alt',
      )}
    >
      {label}
    </button>
  )
}

/** tone → 締切カウントダウンの色/太さ/サイズ（design-spec §5）。 */
const TONE_CLASS: Record<DeadlineTone, string> = {
  today: 'text-accent-fg font-bold text-[15px]',
  soon: 'text-ink font-bold text-[15px]',
  normal: 'text-ink-2 text-xs',
  past: 'text-ink-muted text-xs',
  none: 'text-ink-muted text-xs',
}

function EventRow({
  event,
  todayStr,
}: {
  event: EventListItem
  todayStr: string
}) {
  const countdown = formatDeadlineCountdown(event.internalDeadline, todayStr)
  const isCancelled = event.status === 'cancelled'
  const remaining = event.attendCount - event.chipSurnames.length

  return (
    <Link
      href={`/events/${event.id}`}
      className="block px-0.5 py-[13px] transition-colors hover:bg-surface-alt"
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-display font-bold text-ink tabular-nums">
          {formatEventDate(event.eventDate)}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-display text-[18px] font-bold',
            isCancelled ? 'text-ink-meta' : 'text-ink',
          )}
        >
          {event.title}
        </span>
        <StatusPill status={event.status} size="sm" />
        <span className="shrink-0 whitespace-nowrap">
          <span className="mr-1 text-[10px] text-ink-muted">締切</span>
          <span className={TONE_CLASS[countdown.tone]}>{countdown.text}</span>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-meta">
          参加 {event.attendCount}名
        </span>
        {event.chipSurnames.map((name, i) => (
          <span
            key={`${event.id}-${i}`}
            className="inline-flex items-center rounded-full bg-neutral-bg px-2 py-0.5 text-xs text-neutral-fg"
          >
            {name}
          </span>
        ))}
        {remaining > 0 && (
          <span className="text-[11px] text-ink-meta">他{remaining}名</span>
        )}
      </div>
    </Link>
  )
}
