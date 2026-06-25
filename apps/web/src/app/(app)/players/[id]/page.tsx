import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, GradePill, Pill } from '@/components/ui'
import { getPlayerRecord } from '@/lib/players/queries'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  walkover: '不戦勝',
  forfeit: '棄権',
}

/**
 * /players/[id] — 選手戦績の詳細（全ログインユーザー）。
 *
 * その選手の全出場（大会/級/順位/各試合の相手・枚数・勝敗）を読み取り専用で
 * 表示。通算勝敗は status=normal のみ集計（不戦勝・棄権は別表示）。
 */
export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')

  const { id } = await params
  const playerId = Number(id)
  if (!Number.isInteger(playerId) || playerId <= 0) notFound()

  const record = await getPlayerRecord(playerId)
  if (!record) notFound()

  const { player, participations, totalWins, totalLosses } = record

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/players" className="text-sm text-brand-fg underline">
          ← 選手検索へ戻る
        </Link>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-xl font-bold text-ink">{player.displayName}</h1>
          <div className="text-xs text-ink-meta">
            {[player.affiliation, player.prefecture].filter(Boolean).join(' / ') || '所属不明'}
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm">
            <span className="text-ink">
              通算 <span className="font-bold text-success-fg">{totalWins}</span> 勝{' '}
              <span className="font-bold text-danger-fg">{totalLosses}</span> 敗
            </span>
            <span className="text-xs text-ink-meta">（実戦のみ・不戦勝/棄権は除く）</span>
          </div>
        </div>
      </Card>

      {participations.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-ink-meta">出場記録がありません。</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {participations.map((part) => (
            <Card key={part.participantId}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{part.tournamentName}</div>
                    <div className="mt-0.5 text-xs text-ink-meta">
                      {part.eventDate ?? '開催日不明'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {part.grade && <GradePill grade={part.grade} size="sm" />}
                    {part.finalRank && (
                      <Pill tone="brand" size="sm">
                        {part.finalRank}
                      </Pill>
                    )}
                  </div>
                </div>
                <div className="text-xs text-ink-meta">
                  {[part.className, part.affiliation].filter(Boolean).join(' ・ ')}
                </div>

                {part.matches.length > 0 && (
                  <table className="w-full text-xs text-ink">
                    <thead>
                      <tr className="border-b border-border-soft text-left text-ink-meta">
                        <th className="py-1 pr-2">回戦</th>
                        <th className="py-1 pr-2">相手</th>
                        <th className="py-1 pr-2 text-right">枚数</th>
                        <th className="py-1 text-right">勝敗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {part.matches.map((m, mi) => (
                        <tr key={mi} className="border-b border-border-soft/50">
                          <td className="py-0.5 pr-2 text-ink-meta">
                            {m.roundLabel ?? `${m.round}回戦`}
                          </td>
                          <td className="py-0.5 pr-2">{m.opponentName ?? '—'}</td>
                          <td className="py-0.5 pr-2 text-right">
                            {m.status === 'normal' ? m.scoreDiff : (STATUS_LABEL[m.status] ?? '—')}
                          </td>
                          <td className="py-0.5 text-right">
                            <span
                              className={
                                m.result === 'win' ? 'text-success-fg' : 'text-danger-fg'
                              }
                            >
                              {m.result === 'win' ? '○' : '×'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
