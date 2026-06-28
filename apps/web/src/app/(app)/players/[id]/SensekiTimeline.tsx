'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * 戦績詳細の年タイムライン（design-spec A / クライアント）。
 * 暦年で畳み、年見出しは sticky で追従。展開単位＝年（その年の全大会＋試合表）。
 * 相手名は黒・通常テキストのまま（明示 affordance なし）。解決済みのみ戦績へ遷移（R1）。
 */

export interface TimelineMatch {
  /** 表示用の回戦ラベル（round_label ?? `${round}回戦`）。 */
  roundLabel: string
  opponentName: string | null
  /** 解決済みのみ。タップで /players/[id] へ。未解決は null。 */
  opponentPlayerId: number | null
  opponentAffiliation: string | null
  /** 枚数+勝敗の1トークン（`○12` / `×7` / `不戦勝` / `棄権`）。 */
  scoreText: string
  scoreTone: 'win' | 'lose' | 'muted'
}

export interface TimelineTournament {
  participantId: number
  /** `M/D`（開催日不明は空）。 */
  dateLabel: string
  /** 大会名（「第N回」除去・級letter後置, 例「北海道選手権A」）。 */
  title: string
  rank: string | null
  /** 優勝・準優勝（bracket<=2）は藍で強調。 */
  rankEmphasis: boolean
  /** 決勝→1回戦の降順。 */
  matches: TimelineMatch[]
}

export interface TimelineYear {
  /** 暦年（`"2026"`）または `"不明"`。 */
  year: string
  tournamentCount: number
  wins: number
  losses: number
  tournaments: TimelineTournament[]
}

function scoreClass(tone: TimelineMatch['scoreTone']): string {
  if (tone === 'win') return 'font-semibold text-success-fg'
  if (tone === 'lose') return 'font-semibold text-danger-fg'
  return 'text-ink-muted'
}

export function SensekiTimeline({ years }: { years: TimelineYear[] }) {
  // 最新年（先頭）のみ初期展開。
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    years.length > 0 ? { [years[0]!.year]: true } : {},
  )
  const toggle = (year: string) =>
    setOpen((prev) => ({ ...prev, [year]: !prev[year] }))

  return (
    <div className="flex flex-col">
      {years.map((g) => {
        const isOpen = !!open[g.year]
        return (
          <div key={g.year}>
            <button
              type="button"
              onClick={() => toggle(g.year)}
              aria-expanded={isOpen}
              className="sticky top-0 z-[2] flex w-full items-center justify-between border-b border-border-strong bg-canvas py-2.5 text-left"
            >
              <span
                className={`font-display text-[15px] font-bold ${isOpen ? 'text-brand' : 'text-ink'}`}
              >
                {g.year === '不明' ? '開催日不明' : `${g.year}年`}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-meta">
                <span>
                  {g.tournamentCount}大会 ・ {g.wins}勝{g.losses}敗
                </span>
                <span className="text-ink-muted" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="pb-1.5">
                {g.tournaments.map((t, ti) => (
                  <div
                    key={t.participantId}
                    className={ti > 0 ? 'border-t border-border-soft' : ''}
                  >
                    <div className="flex items-baseline justify-between gap-2.5 py-2">
                      <div className="flex min-w-0 items-baseline gap-2">
                        {t.dateLabel && (
                          <span className="shrink-0 text-xs tabular-nums text-ink-meta">
                            {t.dateLabel}
                          </span>
                        )}
                        <span className="truncate font-display text-[15px] font-medium text-ink">
                          {t.title}
                        </span>
                      </div>
                      {t.rank && (
                        <span
                          className={`shrink-0 text-xs ${t.rankEmphasis ? 'font-semibold text-brand' : 'text-ink-muted'}`}
                        >
                          {t.rank}
                        </span>
                      )}
                    </div>

                    {t.matches.length > 0 && (
                      <table className="mb-3 w-full text-xs text-ink">
                        <tbody>
                          {t.matches.map((m, mi) => (
                            <tr key={mi}>
                              <td className="w-12 py-0.5 align-top text-ink-muted">
                                {m.roundLabel}
                              </td>
                              <td className="py-0.5 pl-2">
                                {m.opponentName ? (
                                  m.opponentPlayerId ? (
                                    <Link
                                      href={`/players/${m.opponentPlayerId}`}
                                      className="text-ink"
                                    >
                                      {m.opponentName}
                                    </Link>
                                  ) : (
                                    <span className="text-ink">{m.opponentName}</span>
                                  )
                                ) : (
                                  <span className="text-ink-muted">—</span>
                                )}
                                {m.opponentAffiliation && (
                                  <span className="ml-1 text-[11px] text-ink-muted">
                                    （{m.opponentAffiliation}）
                                  </span>
                                )}
                              </td>
                              <td className="w-12 py-0.5 pl-2 text-right tabular-nums">
                                <span className={scoreClass(m.scoreTone)}>{m.scoreText}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
