'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, Pill, SectionLabel } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatEventDate } from '@/lib/event-date'
import type {
  HomeEntrant,
  HomeTimelineData,
  HomeTimelineEvent,
  HomeUnansweredAlert,
} from './home-timeline-types'
import {
  INITIAL_VISIBLE_COUNT,
  alertCountdown,
  confidenceLabel,
  splitTimelineDate,
} from './home-timeline-utils'

/**
 * ホーム（`/dashboard`）本体 = 「会の出場予定」。
 *
 * 主役は**顔ぶれ**（誰が出るのか）。日付・大会名は行の見出しに畳み、面積は
 * 出場者チップに割く。`/events` は「申込の締切管理」、ここは「会の顔ぶれ」という
 * 住み分け（同じ大会を別のレンズで見る）。
 *
 * `Date.now()` は呼ばない（`todayStr` はサーバーが渡す）。
 */
export function HomeTimeline({ data }: { data: HomeTimelineData }) {
  const { today, upcoming, alerts, viewerUserId } = data
  const isEmpty = today.length === 0 && upcoming.length === 0

  return (
    <div className="flex flex-col gap-4 p-4">
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <UnansweredAlertRow key={alert.eventId} alert={alert} />
          ))}
        </div>
      )}

      {today.map((event) => (
        <TodayCard key={event.eventId} event={event} viewerUserId={viewerUserId} />
      ))}

      <div>
        <SectionLabel action={<Link href="/events">大会申込へ</Link>}>
          出場予定
        </SectionLabel>
        {isEmpty ? (
          <Card>
            <div className="py-6 text-center text-ink-meta">
              出場予定の大会はありません
            </div>
          </Card>
        ) : upcoming.length === 0 ? (
          <Card>
            <div className="py-6 text-center text-ink-meta">
              この先の出場予定はありません
            </div>
          </Card>
        ) : (
          <TimelineList events={upcoming} viewerUserId={viewerUserId} />
        )}
      </div>
    </div>
  )
}

/**
 * 未回答アラート（1 大会 1 行）。自分の級が対象の大会で、基準締切の 7 日前から
 * 出す。タップで該当イベント詳細（回答フォーム）へ直結する。
 *
 * 朱（accent）を使う唯一の場所。「データの装飾」ではなく「自分が手を動かす必要が
 * ある」という状態表示なので、`/events` の当日締切バッジと同じ扱い。
 */
function UnansweredAlertRow({ alert }: { alert: HomeUnansweredAlert }) {
  return (
    <Link
      href={`/events/${alert.eventId}`}
      className="flex items-center gap-2.5 rounded-[10px] border border-accent bg-accent-bg px-3 py-2.5 transition-opacity hover:opacity-90"
    >
      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-ink-on-brand">
        未回答
      </span>
      <span className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-ink">
        {alert.displayName}
      </span>
      <span className="shrink-0 text-[12px] font-semibold text-accent-fg tabular-nums">
        {alertCountdown(alert.daysLeft)}
      </span>
      <span aria-hidden className="shrink-0 text-[13px] text-accent-fg">
        ›
      </span>
    </Link>
  )
}

/**
 * 大会当日にだけ最上部へ出るカード。会場と顔ぶれを 1 枚で読み切れるようにする。
 *
 * `Card` の内側 padding は 14px 固定なので、藍帯を端まで届かせるためにここでは
 * `Card` を使わず同じ表層クラス（`bg-surface border border-border rounded-[10px]`）
 * を持つ要素を組む（`Card` の doc コメントが指示する回避法）。
 */
function TodayCard({
  event,
  viewerUserId,
}: {
  event: HomeTimelineEvent
  viewerUserId: string | null
}) {
  return (
    <Link
      href={`/events/${event.eventId}`}
      className="block overflow-hidden rounded-[10px] border border-border bg-surface"
    >
      <div className="flex items-baseline gap-2 bg-brand px-[14px] py-1.5 text-ink-on-brand">
        <span className="font-display text-[13px] font-bold tracking-[0.12em]">
          本日
        </span>
        <span className="font-display text-[14px] font-bold tabular-nums">
          {formatEventDate(event.eventDate)}
        </span>
      </div>
      <div className="p-[14px]">
        <div className="font-display text-[21px] leading-tight font-bold text-ink">
          {event.displayName}
        </div>
        {event.venue && (
          <div className="mt-1 text-[13px] text-ink-meta">{event.venue}</div>
        )}
        <div className="mt-3 flex items-baseline gap-2">
          <Pill tone={event.confidence === 'confirmed' ? 'brand' : 'neutral'}>
            {confidenceLabel(event.confidence)}
          </Pill>
          <EntrantCount count={event.entrants.length} />
        </div>
        <EntrantChips entrants={event.entrants} viewerUserId={viewerUserId} />
      </div>
    </Link>
  )
}

/**
 * 出場タイムライン。初期は {@link INITIAL_VISIBLE_COUNT} 件だけ出し、残りは
 * 「もっと見る」で同じ画面に展開する（`/events` へ飛ばさない —— ホームで顔ぶれを
 * 眺め切れることを優先）。展開状態は画面内のみで永続化しない。
 */
function TimelineList({
  events,
  viewerUserId,
}: {
  events: HomeTimelineEvent[]
  viewerUserId: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const hiddenCount = events.length - INITIAL_VISIBLE_COUNT
  const rows = expanded ? events : events.slice(0, INITIAL_VISIBLE_COUNT)

  return (
    <div>
      <ul className="divide-y divide-border-soft border-y border-border-soft">
        {rows.map((event) => (
          <li key={event.eventId}>
            <TimelineRow event={event} viewerUserId={viewerUserId} />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-3 text-[13px] font-semibold text-brand transition-colors hover:bg-surface-alt"
        >
          もっと見る（残り{hiddenCount}件）
        </button>
      )}
    </div>
  )
}

function TimelineRow({
  event,
  viewerUserId,
}: {
  event: HomeTimelineEvent
  viewerUserId: string | null
}) {
  const { md, weekday } = splitTimelineDate(event.eventDate)

  return (
    <Link
      href={`/events/${event.eventId}`}
      className="flex gap-3 py-3 transition-colors hover:bg-surface-alt"
    >
      {/* 日付レール: タイムラインの背骨。数字だけ明朝で大きく、曜日を下に添える */}
      <div className="w-[46px] shrink-0 text-center">
        <div className="font-display text-[17px] leading-none font-bold text-ink tabular-nums">
          {md}
        </div>
        <div className="mt-1 text-[11px] leading-none text-ink-meta">
          {weekday}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate font-display text-[16px] font-bold text-ink">
            {event.displayName}
          </span>
          <Pill
            tone={event.confidence === 'confirmed' ? 'brand' : 'neutral'}
            size="sm"
          >
            {confidenceLabel(event.confidence)}
          </Pill>
          <span className="ml-auto shrink-0 pl-1">
            <EntrantCount count={event.entrants.length} />
          </span>
        </div>
        <EntrantChips entrants={event.entrants} viewerUserId={viewerUserId} />
      </div>
    </Link>
  )
}

/** 「6名」。数字だけ明朝で大きく（`/events` 一覧の人数表示と同じ語彙）。 */
function EntrantCount({ count }: { count: number }) {
  return (
    <span className="font-display text-[17px] leading-none font-bold text-brand tabular-nums">
      {count}
      <small className="ml-px text-[11px] font-normal text-ink-meta">名</small>
    </span>
  )
}

/**
 * 出場者チップ。**級で束ねず一列**に流す（級は各チップ内の小さな添え字）。
 * 自分のチップだけ藍で塗って探しやすくする（独立した「自分」セクションは作らない）。
 */
function EntrantChips({
  entrants,
  viewerUserId,
}: {
  entrants: HomeEntrant[]
  viewerUserId: string | null
}) {
  if (entrants.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {entrants.map((entrant, i) => (
        <EntrantChip
          key={`${entrant.userId ?? 'unknown'}-${i}`}
          entrant={entrant}
          isViewer={viewerUserId != null && entrant.userId === viewerUserId}
        />
      ))}
    </div>
  )
}

function EntrantChip({
  entrant,
  isViewer,
}: {
  entrant: HomeEntrant
  isViewer: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-[3px] whitespace-nowrap rounded-full px-2 py-[3px] text-[13px] leading-[1.35]',
        isViewer
          ? 'bg-brand font-bold text-ink-on-brand'
          : 'border border-border-soft bg-surface-alt text-ink-2',
      )}
    >
      {entrant.surname}
      {entrant.grade && (
        <span
          className={cn(
            // 10px の添え字なので surface-alt 上では ink-meta (4.16:1) では
            // 足りない。neutral-fg (6.71:1) を使う（globals.css のコントラスト注記）。
            'font-mono text-[10px] font-semibold',
            isViewer ? 'text-ink-on-brand' : 'text-neutral-fg',
          )}
        >
          {entrant.grade}
        </span>
      )}
    </span>
  )
}
