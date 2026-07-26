'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  AREAS,
  deadlineBadgeOf,
  displayName,
  groupBoard,
  isAreaHot,
  isPinnedWhenCollapsed,
  type AreaDef,
  type AreaId,
  type DeadlineTone,
  type EntryBoardItem,
} from './entry-board-utils'

/**
 * 申込管理ボード（タイムライン型）。
 *
 * 左に 1 本のレールを通し、各フェーズをその上のノードとして並べる。大会が
 * 上から下へ進んでいく構造をそのまま画面の構造にすることで、「どの大会が
 * どのフェーズにいるか」をスクロールせず読み下せるようにする。
 *
 * 1 大会 = 1 行（約 24px）。通称+級 / そのフェーズで見る締切 / 参加人数のみ。
 */
export function EntryBoardClient({
  items,
  todayStr,
}: {
  items: EntryBoardItem[]
  todayStr: string
}) {
  const grouped = groupBoard(items, todayStr)
  // 空状態は「取得した行数」ではなく「非表示条件を落とした後の件数」で判定する。
  // 要件 §3.2.1 の母集団は非表示条件（手動見送り・締切超過で出欠 0 名）を
  // 引いたものなので、全件が非表示に落ちたときは 5 つの空区画ではなく
  // 空状態を出すのが正しい（§3.2.10）。
  const visibleCount = AREAS.reduce((n, area) => n + grouped[area.id].length, 0)

  if (visibleCount === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface py-10 text-center text-ink-meta">
        管理対象の大会はありません
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {AREAS.map((area, i) => (
        <AreaBlock
          key={area.id}
          area={area}
          items={grouped[area.id]}
          todayStr={todayStr}
          isFirst={i === 0}
          isLast={i === AREAS.length - 1}
        />
      ))}
    </div>
  )
}

function AreaBlock({
  area,
  items,
  todayStr,
  isFirst,
  isLast,
}: {
  area: AreaDef
  items: EntryBoardItem[]
  todayStr: string
  isFirst: boolean
  isLast: boolean
}) {
  const empty = items.length === 0
  const collapsible = area.collapsible === true
  const [open, setOpen] = useState(area.collapsedByDefault !== true)
  const expanded = !collapsible || open

  // 畳んでいても、締切が迫った行だけは出し続ける
  const pinned = items.filter((i) => isPinnedWhenCollapsed(i, area.id, todayStr))
  const visible = expanded ? items : pinned
  const hiddenCount = items.length - visible.length

  // 締切が到来した大会を抱えているときだけ強調する（要件 §isAreaHot）
  const hot = isAreaHot(area, items, todayStr)

  const heading = (
    <>
      <h2
        className={cn(
          'text-[13px] font-bold leading-none',
          hot
            ? 'text-danger-fg'
            : area.actionable && !empty
              ? 'text-danger'
              : empty
                ? 'text-ink-muted'
                : 'text-ink-2',
        )}
      >
        {area.label}
      </h2>
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[11px] font-bold leading-[14px] tabular-nums',
          hot
            ? 'bg-danger text-ink-on-brand'
            : empty
              ? 'text-ink-muted'
              : 'text-ink-meta',
        )}
      >
        {items.length}件
      </span>
      {collapsible && (
        <span
          aria-hidden
          className={cn(
            'shrink-0 text-[9px] leading-none text-ink-muted transition-transform',
            expanded && 'rotate-90',
          )}
        >
          ▶
        </span>
      )}
      {/* 行の日付列の真上に来るよう、同じ幅・同じ右端に固定する */}
      <span aria-hidden className="ml-auto w-[62px] shrink-0" />
      <span className="w-[52px] shrink-0 text-right text-[10px] leading-none text-ink-muted">
        {area.deadlineHint}
      </span>
    </>
  )

  return (
    <section className="flex gap-2.5">
      {/* タイムラインのレール。ノード＝フェーズ、線＝大会が進む道筋 */}
      <div className="flex w-[11px] shrink-0 flex-col items-center">
        <span
          className={cn('w-0.5 h-[7px] shrink-0', !isFirst && 'bg-border')}
        />
        <span
          className={cn(
            'shrink-0 rounded-full',
            hot
              ? 'h-[13px] w-[13px] bg-danger'
              : area.actionable && !empty
                ? 'h-[9px] w-[9px] border-2 border-danger bg-surface'
                : empty
                  ? 'h-[9px] w-[9px] border-2 border-border bg-surface'
                  : 'h-[9px] w-[9px] border-2 border-border-strong bg-surface',
          )}
        />
        <span className={cn('w-0.5 flex-1', !isLast && 'bg-border')} />
      </div>

      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
        {/*
          締切が到来したフェーズだけ面で塗る。レールと二重の囲みにならないよう
          枠線は付けず、背景だけで差をつける。左へ少し食い込ませてレールと
          つながって見えるようにしている。
        */}
        <div
          className={cn(
            'pr-1',
            hot && '-ml-1.5 rounded-r-md bg-danger-bg pb-1 pl-1.5',
          )}
        >
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 py-1 text-left"
          >
            {heading}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 py-1">{heading}</div>
        )}

        {empty && expanded ? (
          <div className="py-0.5 text-[11px] leading-none text-ink-muted">
            なし
          </div>
        ) : visible.length > 0 ? (
          <ul className="divide-y divide-border-soft">
            {visible.map((item) => (
              <li key={item.id}>
                <EntryRow item={item} area={area} todayStr={todayStr} />
              </li>
            ))}
            {!expanded && hiddenCount > 0 && (
              <li className="py-1 text-[10px] leading-[16px] text-ink-muted">
                ほか{hiddenCount}件
              </li>
            )}
          </ul>
        ) : null}
        </div>
      </div>
    </section>
  )
}

function toneClass(tone: DeadlineTone, actionable: boolean): string {
  switch (tone) {
    case 'past':
      return actionable ? 'text-danger-fg font-bold' : 'text-ink-muted'
    case 'today':
      return 'text-accent-fg font-bold'
    case 'soon':
      return 'text-ink font-bold'
    case 'normal':
      return 'text-ink-2'
    default:
      return 'text-ink-muted'
  }
}

function EntryRow({
  item,
  area,
  todayStr,
}: {
  item: EntryBoardItem
  area: AreaDef
  todayStr: string
}) {
  const badge = deadlineBadgeOf(item, area.id, todayStr)
  // 残日数は「差し迫っているとき」だけ出す。tone 'normal'（4日以上先）は
  // 読む必要がないので空にし、日付だけ残す。
  const showCountdown =
    area.showCountdown !== false && badge.tone !== 'normal'
  // 残日数を出さない区画で日付も無い場合は、その旨を日付側に出す
  const dateText = badge.date ?? (showCountdown ? null : badge.countdown)

  return (
    <Link
      href={`/events/${item.id}`}
      className="flex items-baseline gap-1.5 py-[3px] text-[12px] leading-[16px] transition-colors hover:bg-surface-alt"
    >
      <span className="flex min-w-0 flex-1 items-baseline">
        <span className="truncate font-bold text-ink">{displayName(item)}</span>
        <span className="shrink-0 tabular-nums text-ink-meta">
          （{item.attendCount}名）
        </span>
      </span>
      {/*
        締切は 2 つの固定幅スロットに分ける。左＝日付（種類が行ごとに変わる
        「申込済み・抽選待ち」だけ種類も添える）、右＝残日数。行をまたいで
        縦に揃うので、縦に目で追える。
      */}
      <span
        className={cn(
          'w-[62px] shrink-0 whitespace-nowrap text-right tabular-nums',
          toneClass(badge.tone, area.actionable),
        )}
      >
        {showCountdown ? badge.countdown : null}
      </span>
      <span className="w-[52px] shrink-0 whitespace-nowrap text-right tabular-nums text-ink-meta">
        {dateText}
      </span>
    </Link>
  )
}
