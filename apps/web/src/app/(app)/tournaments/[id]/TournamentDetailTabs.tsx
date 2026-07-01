'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ClassBlock, CrosstabCell, WinnerPlace } from '@/lib/stats/results'
import { cn } from '@/lib/utils'

/**
 * 大会詳細のタブ（design-spec §3.5）。ttabs＝入賞者 ｜ 級A ｜ 級B …（分割時 A1/A2・横スクロール）。
 * 入賞者タブは全級ブロックの入賞者を段組み、級タブは 1 ブロックのクロス表（選手×回戦・勝ち上がり順・
 * 敗退後空欄）を表示。○＝藍／×＝中立インク（朱不使用）・不戦＝薄字。行タップ→戦績詳細。
 *
 * 級タブは選択中の 1 ブロックだけ描画する（大規模級でも DOM を最小に）。
 */
export function TournamentDetailTabs({ blocks }: { blocks: ClassBlock[] }) {
  // 'winners' か classId。既定は入賞者。
  const [active, setActive] = useState<'winners' | number>('winners')
  const activeBlock =
    typeof active === 'number' ? blocks.find((b) => b.classId === active) : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* ttabs（横スクロールピル） */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div role="tablist" aria-label="大会詳細タブ" className="flex w-max gap-2">
          <TabPill label="入賞者" active={active === 'winners'} onClick={() => setActive('winners')} />
          {blocks.map((b) => (
            <TabPill
              key={b.classId}
              label={b.label}
              active={active === b.classId}
              onClick={() => setActive(b.classId)}
            />
          ))}
        </div>
      </div>

      {active === 'winners' ? (
        <WinnersView blocks={blocks} />
      ) : activeBlock ? (
        <CrosstabView block={activeBlock} />
      ) : null}
    </div>
  )
}

function TabPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
        active ? 'bg-brand text-white' : 'border border-border bg-surface text-ink-meta hover:bg-surface-alt',
      )}
    >
      {label}
    </button>
  )
}

/** 級ブロックの見た目ラベル（単一級は「A級」、分割は「A1」、級なしは className）。 */
function blockBadge(b: ClassBlock): string {
  if (b.grade == null) return b.className
  return b.label === b.grade ? `${b.grade}級` : b.label
}

/** 順位ピルの藍濃淡（design-spec §3.5：p1=藍/p2=藍薄/p3=砂寄り中立/p4=面）。朱は不使用。 */
const PLACE_PILL: Record<1 | 2 | 3 | 4, string> = {
  1: 'bg-brand text-white',
  2: 'bg-brand-bg text-brand-fg',
  3: 'bg-neutral-bg text-neutral-fg',
  4: 'border border-border bg-surface text-ink-meta',
}

/** 入賞者タブ：全級ブロックの入賞者を段組みで。 */
function WinnersView({ blocks }: { blocks: ClassBlock[] }) {
  const withWinners = blocks.filter((b) => b.winners.length > 0)
  if (withWinners.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-meta">入賞者を表示できる級がありません。</p>
  }
  return (
    <div className="flex flex-col gap-5">
      {withWinners.map((b) => (
        <section key={b.classId} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2">
            <span className="rounded-full bg-info-bg px-2 py-0.5 font-mono text-[11px] font-semibold text-info-fg">
              {blockBadge(b)}
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {b.winners.map((place) => (
              <PlaceRow key={place.place} place={place} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function PlaceRow({ place }: { place: WinnerPlace }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          'mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
          PLACE_PILL[place.place],
        )}
      >
        {place.label}
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
        {place.entries.map((e) => (
          <li key={e.participantId} className="min-w-0">
            {e.playerId != null ? (
              <Link href={`/players/${e.playerId}`} className="flex items-baseline gap-2 hover:underline">
                <span className="truncate font-display text-[15px] text-ink">{e.name}</span>
                {e.affiliation ? (
                  <span className="truncate text-xs text-ink-meta">{e.affiliation}</span>
                ) : null}
              </Link>
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="truncate font-display text-[15px] text-ink">{e.name}</span>
                {e.affiliation ? (
                  <span className="truncate text-xs text-ink-meta">{e.affiliation}</span>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 級タブ：クロス表（選手×回戦）。氏名列を sticky にして回戦は横スクロール（唯一の横スクロール例外・
 * design-spec §7）。敗退後の回戦は空セル＝勝ち残りが逆三角形に見える。行タップ→戦績詳細。
 */
function CrosstabView({ block }: { block: ClassBlock }) {
  const router = useRouter()
  const { columns, rows } = block.crosstab
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-meta">この級の対戦記録がありません。</p>
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-1.5 text-left font-medium text-ink-meta">
              選手
            </th>
            {columns.map((c) => (
              <th
                key={c.round}
                className="min-w-[5.5rem] border-b border-border px-2 py-1.5 text-center font-medium text-ink-meta"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.participantId}
              // 行全体タップで戦績詳細へ（design-spec §3.5「行タップ→戦績詳細」）。氏名セルは
              // キーボード操作用に Link も残す（クリックは行 onClick と同一 URL で冪等）。相手名は
              // 非リンクなので、相手セルのタップも「その行の選手」の戦績へ向かう。
              className={r.playerId != null ? 'cursor-pointer hover:bg-surface-alt' : 'hover:bg-surface-alt'}
              onClick={r.playerId != null ? () => router.push(`/players/${r.playerId}`) : undefined}
            >
              <th className="sticky left-0 z-10 border-b border-border-soft bg-surface px-2 py-1.5 text-left font-normal">
                {r.playerId != null ? (
                  <Link href={`/players/${r.playerId}`} className="block max-w-[7rem] truncate font-display text-[13px] text-ink hover:underline">
                    {r.name}
                  </Link>
                ) : (
                  <span className="block max-w-[7rem] truncate font-display text-[13px] text-ink">{r.name}</span>
                )}
              </th>
              {columns.map((c) => (
                <td key={c.round} className="border-b border-border-soft px-1 py-1 text-center align-top">
                  <Cell cell={r.cells[c.round]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** クロス表 1 セル。○＝藍/×＝中立インク、不戦＝薄字（相手/枚数なし）。空セルは何も描かない。 */
function Cell({ cell }: { cell: CrosstabCell | undefined }) {
  if (!cell) return null
  const isBye = cell.status !== 'normal'
  const mark = cell.result === 'win' ? '○' : '×'
  return (
    <div className="flex flex-col items-center leading-tight">
      <span
        className={cn(
          'font-bold',
          isBye ? 'text-ink-muted' : cell.result === 'win' ? 'text-brand' : 'text-ink-meta',
        )}
      >
        {mark}
      </span>
      {!isBye && cell.opponentName ? (
        <span className="max-w-[5rem] truncate text-[10px] text-ink-meta">{cell.opponentName}</span>
      ) : null}
      {!isBye && cell.scoreDiff != null ? (
        <span className="text-[10px] tabular-nums text-ink-muted">{cell.scoreDiff}枚</span>
      ) : null}
    </div>
  )
}
