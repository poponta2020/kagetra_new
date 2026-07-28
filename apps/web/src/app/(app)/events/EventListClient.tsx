'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { Card, StatusPill } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatEventDate } from '@/lib/event-date'
import {
  formatDeadlineCountdown,
  formatEventDay,
  groupEventsByMonth,
  isOpenForEntry,
  isRowVisible,
  sortEvents,
  type EventListItem,
  type MonthGroup,
  type SortAxis,
  type WeekdayTone,
} from './event-list-utils'

/**
 * 日付ブロックの曜日色（design-spec §2-3）。日曜=朱・土曜=藍はカレンダー慣習
 * としての意図的例外（「朱=警告系」原則の例外・ユーザー承認済み §3-3）。
 */
const WEEKDAY_TONE_CLASS: Record<WeekdayTone, string> = {
  sun: 'text-accent',
  sat: 'text-brand',
  weekday: 'text-ink-meta',
}

/**
 * 大会申込（`/events`）一覧のクライアント本体（design-spec B案・区切り線リスト）。
 *
 * サーバーが畳んだ最小データ（EventListItem[]）＋JST `todayStr` を受け取り、
 * 「フィルタ（申込可能のみ）→ ソート（締切日順/開催日順）」して描画する。
 * `Date.now()` は呼ばず `todayStr` を使う＝hydration mismatch を避ける。
 * ソート/フィルタ状態は画面内のみ（永続化しない・再訪で既定に戻る）。
 *
 * event-list-month-grouping: **開催日順のときだけ**月セクションに束ねる
 * （design-spec §2 の delta は「開催日順のみ」がスコープ）。締切日順は開催月と
 * 締切月が食い違うため月区切りせず、行も出荷済みのフラットな形のまま出す。
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

  // 可視判定（締切超過は自分が attend=true でない限り隠す）→ 申込可能フィルタ
  // → ソート、の順で適用する（実装手順書 タスク3）。
  const visible = items.filter((e) => isRowVisible(e, todayStr))

  // 可視 0 件：コントロールを出さず現状文言。締切超過で全行隠れた場合も
  // ここに含まれる（オフシーズンで普通に起きるため、フィルタ 0 件の文言と
  // 混同しない）。
  if (visible.length === 0) {
    return (
      <Card>
        <div className="text-center text-ink-meta py-6">
          現在のイベントはありません
        </div>
      </Card>
    )
  }

  const filtered = applicableOnly ? visible.filter((e) => e.canApply) : visible
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
            {/* つまみは意図的に純白のまま。OFF 時のトラックが bg-neutral-bg
                (#ebe3ce) なので、bg-surface (#fbf7ed) だとコントラストが
                足りずつまみの位置が読み取れない。 */}
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
      ) : sort === 'date' ? (
        <div className="flex flex-col gap-[14px]">
          {groupEventsByMonth(rows).map((group) => (
            <section key={group.key}>
              <MonthHeading group={group} />
              {/* 月見出しの藍太罫が上端の罫線を兼ねるので、フラット版の
                  border-y は付けない（行間のヘアラインのみ）。 */}
              <ul className="divide-y divide-border-soft">
                {group.rows.map((event) => (
                  <li key={event.id}>
                    <EventRow event={event} todayStr={todayStr} dateView />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border-soft border-y border-border-soft">
          {rows.map((event) => (
            <li key={event.id}>
              <EventRow event={event} todayStr={todayStr} dateView={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 月セクションの見出し（design-spec §2-2 / T-4）。ゼロ埋め2桁の月数字＋英字
 * 月名＋藍の太罫。件数表記は入れない（ユーザー明示指示）。西暦は年が変わる
 * 最初の見出しにだけ出る（`group.year` が null 以外のときのみ）。
 */
function MonthHeading({ group }: { group: MonthGroup<EventListItem> }) {
  return (
    <div className="flex items-baseline gap-1.5 border-b-[2.5px] border-brand pb-[3px]">
      <span className="text-[31px] leading-none font-semibold tracking-[-0.03em] text-brand tabular-nums">
        {group.month}
      </span>
      <span className="text-[11px] font-medium tracking-[0.1em] text-brand">
        {group.monthAbbr}
      </span>
      {group.year != null && (
        <span className="ml-auto text-[11px] text-ink-muted tabular-nums">
          {group.year}
        </span>
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
        active ? 'bg-brand text-ink-on-brand' : 'text-ink-meta hover:bg-surface-alt',
      )}
    >
      {label}
    </button>
  )
}

/**
 * 締切カウントダウンの表示（design-spec §5 / 忠実度チェックリスト）。
 * tone ごとに構造が異なる（today=塗りピル・soon/normal=数字だけ拡大・
 * past/none=無地）ため tone→className の単純な辞書では表現できず、
 * tone で分岐して組み立てる。日数の数字は `<em>` 相当で分離し、周囲の
 * 「あと」「日」より大きく描画する。
 */
function DeadlineValue({
  countdown,
}: {
  countdown: ReturnType<typeof formatDeadlineCountdown>
}) {
  const { tone, daysLeft, text } = countdown

  if (tone === 'today') {
    return (
      <span className="inline-block rounded-full bg-accent px-[9px] py-px text-[15px] font-bold text-ink-on-brand">
        {text}
      </span>
    )
  }
  if (tone === 'soon') {
    // 3日以内: 数字だけ 19px に拡大。色は墨のまま（朱にしない）。
    return (
      <span className="text-xs text-ink">
        あと
        <em className="mx-px font-display text-[19px] font-bold text-ink not-italic">
          {daysLeft}
        </em>
        日
      </span>
    )
  }
  if (tone === 'normal') {
    return (
      <span className="text-xs text-ink-2">
        あと
        <em className="mx-px font-display text-[15px] font-bold text-ink-2 not-italic">
          {daysLeft}
        </em>
        日
      </span>
    )
  }
  // past（締切済）/ none（—）は数字を持たない無地表示。
  return <span className="text-xs text-ink-muted">{text}</span>
}

function EventRow({
  event,
  todayStr,
  dateView,
}: {
  event: EventListItem
  todayStr: string
  /**
   * 開催日順ビューか。design-spec §2 の delta は「開催日順のみ」がスコープなので
   * （§2-7 でソート非依存と明記されたのはフッター行だけ）、true のときだけ
   * 行頭の日付ブロック・タイトル行からの日付除去・大会名の太さによる二重符号を
   * 適用する。締切日順は月見出しが無く日付ブロックだけでは何月か判らないため、
   * 出荷済み（event-list-redesign）の行をそのまま出す。
   */
  dateView: boolean
}) {
  const countdown = formatDeadlineCountdown(event.internalDeadline, todayStr)
  const isCancelled = event.status === 'cancelled'
  const openForEntry = isOpenForEntry(event, todayStr)
  const day = formatEventDay(event.eventDate)

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-stretch py-[13px] transition-colors hover:bg-surface-alt"
    >
      {/* 色帯: 藍=今この行から申し込める / 砂=それ以外（対象外・中止・締切超過） */}
      <span
        className={cn(
          'w-[3px] shrink-0 rounded-[2px]',
          openForEntry ? 'bg-brand' : 'bg-border',
        )}
      />
      {dateView && (
        <div className="ml-2 w-[34px] shrink-0 pt-0.5 text-center">
          <span className="block text-[19px] leading-[1.1] font-semibold text-ink tabular-nums">
            {day.day}
          </span>
          <span
            className={cn(
              'block text-[10px] font-medium tracking-[0.08em]',
              WEEKDAY_TONE_CLASS[day.tone],
            )}
          >
            {day.weekday}
          </span>
        </div>
      )}
      <div className={cn('min-w-0 flex-1', dateView ? 'pl-[10px]' : 'pl-[11px]')}>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 truncate font-display text-[18px]',
              // 二重符号（§2-4）: 色帯と**必ず同じ条件**で太さを切り替える。
              // 片方だけ変える改修は禁止（§3-2）。中止行は太さより淡色が優先。
              dateView && !openForEntry ? 'font-normal' : 'font-bold',
              isCancelled ? 'text-ink-meta' : 'text-ink',
            )}
          >
            {event.title}
          </span>
          {/* 開催日順では日付は行頭のブロックが担うのでここには出さない（§2-3）。 */}
          {!dateView && (
            <span className="shrink-0 font-display text-[13.5px] font-bold text-ink-2 tabular-nums">
              {formatEventDate(event.eventDate)}
            </span>
          )}
          <StatusPill status={event.status} size="sm" />
          <span className="ml-auto shrink-0 pl-2 whitespace-nowrap">
            <span
              className={cn(
                'mr-1 text-[10px]',
                countdown.tone === 'today' ? 'text-accent-fg' : 'text-ink-muted',
              )}
            >
              締切
            </span>
            <DeadlineValue countdown={countdown} />
          </span>
        </div>

        {event.attendCount > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 font-display text-[19px] leading-none font-bold text-brand">
                {event.attendCount}
                <small className="ml-px text-[11px] font-normal text-ink-meta">
                  名
                </small>
              </span>
              <span className="min-w-0 flex-1 text-xs leading-[1.65] text-neutral-fg">
                {event.attendeeSurnames.map((name, i) => (
                  <Fragment key={`${event.id}-${i}`}>
                    {i > 0 && <span className="mx-1 text-ink-muted">・</span>}
                    <span className="whitespace-nowrap">{name}</span>
                  </Fragment>
                ))}
              </span>
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
