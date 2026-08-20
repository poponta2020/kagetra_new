'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  AREAS,
  groupAttendCount,
  groupBoard,
  groupDeadlineBadge,
  isAreaHot,
  isPinnedWhenCollapsed,
  type AreaDef,
  type DeadlineTone,
  type EntryBoardGroup,
  type EntryBoardItem,
} from './entry-board-utils'

/**
 * 申込管理ボード（タイムライン型・round 13）。
 *
 * 左に 1 本のレールを通し、各フェーズをその上のノードとして並べる。大会が
 * 上から下へ進んでいく構造をそのまま画面の構造にすることで、「どの大会が
 * どのフェーズにいるか」をスクロールせず読み下せるようにする。
 *
 * round 13: **1 申込グループ = 常に 1 行**（複数日グループの日別行への展開は
 * 廃止。design-spec §2-5 / 要件 §3.2.5）。玉はレールから見出し行の中へ移動し、
 * 区画は常に和紙の面（`bg-surface`）で束ねる（強調時のみ `bg-danger-bg`）。
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

  // 畳んでいても、締切が迫った日を1件でも抱えるグループは出し続ける
  // （グループが最小表示単位。グループの一部の日だけを残すことはしない）。
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

  // 見出し行（.ahead）: 玉・見出し・件数ピル・（開閉可なら）キャレット・
  // スペーサー・区画ヒントを 1 行に並べる。玉は負マージンでレール中心へ
  // 引き戻す（design-spec §3-1: px 値ではなく「レール中心と玉中心が一致する」
  // ことが条件）。
  const heading = (
    <>
      <span
        aria-hidden
        data-testid="area-node"
        className={cn(
          '-ml-[22px] -mr-0.5 h-[13px] w-[13px] shrink-0 self-center rounded-full',
          hot
            ? 'border-0 bg-danger'
            : area.actionable && !empty
              ? 'border-2 border-danger bg-surface'
              : empty
                ? 'border-2 border-border bg-surface'
                : 'border-2 border-brand bg-surface',
        )}
      />
      <h2
        className={cn(
          'font-display text-[15px] font-bold leading-[1.2] tracking-[0.03em]',
          hot
            ? 'text-danger-fg'
            : area.actionable && !empty
              ? 'text-danger'
              : empty
                ? 'text-ink-muted'
                : 'text-brand-fg',
        )}
      >
        {area.label}
      </h2>
      <span
        className={cn(
          'self-center rounded-full px-1.5 py-px text-[11px] leading-[14px] tabular-nums',
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
      {/*
        タイムラインのレール。全区画で 1 本の flex:1 の線（区画間の gap 部分も
        含めて途切れず伸びる）。先頭区画だけ pt-[13.5px] で線の始点を最初の玉の
        中心まで下げる（玉より上に線が無い）。終端は最後の区画の acontent が
        pb-0 になることで最終行まで伸びきる。
      */}
      <div
        className={cn(
          'flex w-[11px] shrink-0 flex-col items-center',
          isFirst && 'pt-[13.5px]',
        )}
      >
        <span className="w-0.5 flex-1 bg-border" />
      </div>

      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
        {/*
          区画の面。常に和紙（bg-surface）で束ね、強調時だけ朱面
          （bg-danger-bg）へ切り替える。左へ 6px 食い込ませてレールと
          つながって見えるようにしている（design-spec §3-2）。
        */}
        <div
          className={cn(
            '-ml-1.5 rounded-r-md pl-1.5 pr-2 pt-1 pb-1.5',
            hot ? 'bg-danger-bg' : 'bg-surface',
          )}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={expanded}
              className="mb-0.5 flex w-full items-baseline gap-[7px] pb-1.5 text-left"
            >
              {heading}
            </button>
          ) : (
            <div className="mb-0.5 flex w-full items-baseline gap-[7px] pb-1.5">
              {heading}
            </div>
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
            <ul>
              {visible.map((group) => (
                <li key={group.groupId}>
                  <EntryGroupRow group={group} area={area} todayStr={todayStr} />
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

/**
 * ボードの 1 行 = 1 申込グループ（round 13: 日別行への展開は廃止）。
 *
 * グループ名・締切/抽選日・参加人数はいずれもグループ単位の集約値
 * （{@link groupDeadlineBadge} / {@link groupAttendCount}。entry-board-utils.ts
 * が `pickRepresentativeDay` を介して並び順キーと同じ日から導出している——
 * 並びと表示が食い違わない、要件 §3.2.5.1）。グループ内で締切が食い違う場合、
 * 最も早い日以外の締切はこの行から見えなくなる（design-spec §3-5。受容済み）。
 */
function EntryGroupRow({
  group,
  area,
  todayStr,
}: {
  group: EntryBoardGroup
  area: AreaDef
  todayStr: string
}) {
  const badge = groupDeadlineBadge(group, todayStr)
  // 残日数は「差し迫っているとき」だけ出す。tone 'normal'（4日以上先）は
  // 読む必要がないので空にし、日付だけ残す。
  const showCountdown =
    area.showCountdown !== false && badge.tone !== 'normal'
  // 残日数を出さない区画で日付も無い場合は、その旨を日付側に出す
  const dateText = badge.date ?? (showCountdown ? null : badge.countdown)
  const attendCount = groupAttendCount(group)

  return (
    <Link
      // entry-group-page AC-27: 行の遷移先は代表イベントの日ページではなく
      // 申込グループページへ統一する（シングルトンを含む全行。要件 §3.1・設計判断4）。
      href={`/admin/entries/${group.groupId}`}
      className="flex items-baseline gap-1.5 py-[3px] text-[12px] leading-[16px] transition-colors hover:bg-surface-alt"
    >
      <span className="flex min-w-0 flex-1 items-baseline">
        <span className="truncate font-bold text-ink">{group.name}</span>
        {attendCount > 0 && (
          <span className="shrink-0 tabular-nums text-ink-meta">
            （{attendCount}名）
          </span>
        )}
      </span>
      {/*
        締切は 2 つの固定幅スロットに分ける。左＝残日数、右＝日付。行をまたいで
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
