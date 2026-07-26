'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  AREAS,
  commonDeadlineBadge,
  dayStatusLabel,
  deadlineBadgeOf,
  displayName,
  formatShortDate,
  groupBoard,
  isAreaHot,
  isPinnedWhenCollapsed,
  type AreaDef,
  type DeadlineTone,
  type EntryBoardGroup,
  type EntryBoardItem,
} from './entry-board-utils'

/**
 * 申込管理ボード（タイムライン型）。
 *
 * 左に 1 本のレールを通し、各フェーズをその上のノードとして並べる。大会が
 * 上から下へ進んでいく構造をそのまま画面の構造にすることで、「どの大会が
 * どのフェーズにいるか」をスクロールせず読み下せるようにする。
 *
 * タスク6: 1 行 = 1 大会ではなく **1 行 = 1 申込グループ（カード）**。
 * 複数日のグループはカード内に日別行を持つが、シングルトン（日が1件だけの
 * グループ）は日別行を増やさず、従来どおり 1 行（約 24px）のまま
 * 通称+級 / そのフェーズで見る締切 / 参加人数だけを描く（設計判断6）。
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
  // 空状態を出すのが正しい（§3.2.10）。カード数 = ボードに実際に並ぶ件数。
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
          groups={grouped[area.id]}
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
  groups,
  todayStr,
  isFirst,
  isLast,
}: {
  area: AreaDef
  groups: EntryBoardGroup[]
  todayStr: string
  isFirst: boolean
  isLast: boolean
}) {
  const empty = groups.length === 0
  const collapsible = area.collapsible === true
  const [open, setOpen] = useState(area.collapsedByDefault !== true)
  const expanded = !collapsible || open

  // 畳んでいても、締切が迫った日を1件でも抱えるカードは出し続ける
  // （カードが最小表示単位。カードの一部の行だけを残すことはしない）。
  const pinned = groups.filter((g) =>
    g.days.some((d) => isPinnedWhenCollapsed(d, area.id, todayStr)),
  )
  const visible = expanded ? groups : pinned
  const hiddenCount = groups.length - visible.length

  // 締切が到来した大会を抱えているときだけ強調する（要件 §isAreaHot）。
  // グループの日別行をすべて平らにしてから既存の isAreaHot に渡す
  // （区画の強調判定はイベント単位のまま——1グループの一部の日だけが
  // 到来していても区画は強調する、という fail-safe の方針を維持する）。
  const hot = isAreaHot(
    area,
    groups.flatMap((g) => g.days),
    todayStr,
  )

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
        {groups.length}件
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
        ) : /*
             畳んだときに残す行（締切 3 日以内）が 1 件も無いのが通常の状態
             なので、visible が空でも隠れた件数だけは出す。ここを
             visible.length > 0 だけで塞ぐと「ほかN件」ごと消える。
          */
          visible.length > 0 || (!expanded && hiddenCount > 0) ? (
          <ul className="divide-y divide-border-soft">
            {visible.map((group) => (
              <li key={group.groupId}>
                <EntryGroupCard group={group} area={area} todayStr={todayStr} />
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
        {item.attendCount > 0 && (
          <span className="shrink-0 tabular-nums text-ink-meta">
            （{item.attendCount}名）
          </span>
        )}
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

/**
 * カード = 1 申込グループ（タスク6, AC-14/AC-15）。
 *
 * 日別行が1件（シングルトン。単独イベントの既定グループはこれに当たる）なら
 * {@link EntryRow} と完全に同じ DOM を描く——グループ名見出しや日別行の
 * リストを別途足してノイズを増やさない（設計判断6: 「従来同等の見え方」）。
 * 複数日あるときだけヘッダー（グループ名 + 共通の締切/抽選日）と
 * 日別行のリストを組み立てる。
 */
function EntryGroupCard({
  group,
  area,
  todayStr,
}: {
  group: EntryBoardGroup
  area: AreaDef
  todayStr: string
}) {
  if (group.days.length === 1) {
    return <EntryRow item={group.days[0]!} area={area} todayStr={todayStr} />
  }

  // 設計判断3: カードの区画（area）の観点で見た締切/抽選日が全日別行で
  // 同一なら、ヘッダーに1回だけ出す。1件でも異なれば null——その場合は
  // ヘッダーで日付を出さず、日別行それぞれが自分の締切/抽選日を出す。
  const badge = commonDeadlineBadge(group, todayStr)
  const showHeaderCountdown =
    badge != null && area.showCountdown !== false && badge.tone !== 'normal'
  const headerDateText =
    badge == null ? null : (badge.date ?? (showHeaderCountdown ? null : badge.countdown))

  return (
    <div className="py-[3px]">
      <Link
        href={`/events/${group.representativeEventId}`}
        className="flex items-baseline gap-1.5 text-[12px] leading-[16px] transition-colors hover:bg-surface-alt"
      >
        <span className="min-w-0 flex-1 truncate font-bold text-ink">{group.name}</span>
        {badge && (
          <>
            <span
              className={cn(
                'w-[62px] shrink-0 whitespace-nowrap text-right tabular-nums',
                toneClass(badge.tone, area.actionable),
              )}
            >
              {showHeaderCountdown ? badge.countdown : null}
            </span>
            <span className="w-[52px] shrink-0 whitespace-nowrap text-right tabular-nums text-ink-meta">
              {headerDateText}
            </span>
          </>
        )}
      </Link>
      {/* 日別行。開催日・級・（締切がグループ内で食い違う場合のみ）自分の締切/抽選日。 */}
      <ul className="ml-1.5 divide-y divide-border-soft border-l border-border-soft pl-2">
        {group.days.map((day) => (
          <li key={day.id}>
            <EntryGroupDayRow
              day={day}
              area={area}
              todayStr={todayStr}
              showOwnBadge={badge == null}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function EntryGroupDayRow({
  day,
  area,
  todayStr,
  showOwnBadge,
}: {
  day: EntryBoardItem
  area: AreaDef
  todayStr: string
  /** ヘッダーが共通バッジを出せなかった（食い違いがある）ときだけ true。 */
  showOwnBadge: boolean
}) {
  const badge = deadlineBadgeOf(day, area.id, todayStr)
  const showCountdown = area.showCountdown !== false && badge.tone !== 'normal'
  const dateText = badge.date ?? (showCountdown ? null : badge.countdown)
  const gradeLabel = day.eligibleGrades?.join('') ?? ''

  return (
    <Link
      href={`/events/${day.id}`}
      className="flex items-baseline gap-1.5 py-[3px] text-[11px] leading-[15px] text-ink-2 transition-colors hover:bg-surface-alt"
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span className="shrink-0 tabular-nums text-ink-meta">
          {formatShortDate(day.eventDate)}
        </span>
        {gradeLabel && <span className="shrink-0 text-ink-meta">{gradeLabel}</span>}
        {/*
          カードの区画（area）はグループ内で「最も対応が必要」な方に寄せてある
          ので、日別行はそれとは別に、その日自身の classify 結果を出す
          （設計判断2の前提——カードが要対応でも個々の日は完了済みかもしれない）。
        */}
        <span className="shrink-0 text-[10px] text-ink-muted">{dayStatusLabel(day, todayStr)}</span>
        {day.attendCount > 0 && (
          <span className="shrink-0 tabular-nums text-ink-meta">（{day.attendCount}名）</span>
        )}
      </span>
      {showOwnBadge && (
        <>
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
        </>
      )}
    </Link>
  )
}
