import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPlayerRecord, type PlayerMatchView } from '@/lib/players/queries'
import { SensekiTimeline, type TimelineYear } from './SensekiTimeline'

export const dynamic = 'force-dynamic'

/**
 * /players/[id] — 選手戦績の詳細（全ログインユーザー）。
 *
 * design-spec A（エディトリアル）：上に箱なしのキャリアサマリー、下に暦年で畳む
 * sticky タイムライン（展開＝その年の全大会＋試合表）。順位は対戦から導出
 * （queries 側）、相手名タップでその選手の戦績へ（R1, 解決済みのみ）。
 */

/** 「第N回」接頭を除去（全角数字も）。 */
function stripKai(name: string): string {
  return name.replace(/^第[0-9０-９]+回\s*/, '')
}

/** 枚数+勝敗を1トークン化。normal は ○|差| / ×|差|、不戦勝・棄権は語で。 */
function scoreToken(m: PlayerMatchView): {
  text: string
  tone: 'win' | 'lose' | 'muted'
} {
  if (m.status === 'walkover') return { text: '不戦勝', tone: 'muted' }
  if (m.status === 'forfeit') return { text: '棄権', tone: 'muted' }
  const mark = m.result === 'win' ? '○' : '×'
  const num = m.scoreDiff != null ? String(Math.abs(m.scoreDiff)) : ''
  return { text: `${mark}${num}`, tone: m.result === 'win' ? 'win' : 'lose' }
}

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

  const {
    player,
    participations,
    totalWins,
    totalLosses,
    championships,
    nyushoCount,
    tournamentCount,
    activeYears,
    currentGrade,
  } = record

  const decided = totalWins + totalLosses
  const winRate = decided > 0 ? Math.round((totalWins / decided) * 1000) / 10 : null

  // 暦年でグルーピング（participations は開催日降順済み・null は不明として末尾に集まる）。
  const yearMap = new Map<string, TimelineYear>()
  for (const part of participations) {
    const year = part.eventDate ? part.eventDate.slice(0, 4) : '不明'
    let group = yearMap.get(year)
    if (!group) {
      group = { year, tournamentCount: 0, wins: 0, losses: 0, tournaments: [] }
      yearMap.set(year, group)
    }
    group.tournamentCount += 1
    for (const m of part.matches) {
      if (m.status !== 'normal') continue
      if (m.result === 'win') group.wins += 1
      else group.losses += 1
    }
    const dateLabel = part.eventDate
      ? `${Number(part.eventDate.slice(5, 7))}/${Number(part.eventDate.slice(8, 10))}`
      : ''
    group.tournaments.push({
      participantId: part.participantId,
      dateLabel,
      title: `${stripKai(part.tournamentName)}${part.grade ?? ''}`,
      rank: part.rank,
      rankEmphasis:
        part.rankBracket != null ? part.rankBracket <= 2 : /優勝/.test(part.rank ?? ''),
      matches: [...part.matches].reverse().map((m) => {
        const s = scoreToken(m)
        return {
          roundLabel: m.roundLabel ?? `${m.round}回戦`,
          opponentName: m.opponentName,
          opponentPlayerId: m.opponentPlayerId,
          opponentAffiliation: m.opponentAffiliation,
          scoreText: s.text,
          scoreTone: s.tone,
        }
      }),
    })
  }
  const years = [...yearMap.values()]

  const spanLabel = activeYears
    ? activeYears.from === activeYears.to
      ? `${activeYears.from}`
      : `${activeYears.from}–${activeYears.to}`
    : null
  const chips = [
    `${tournamentCount}大会`,
    `優勝 ${championships}`,
    `入賞 ${nyushoCount}`,
    spanLabel,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link href="/players" className="text-sm text-brand-fg">
          ← 選手検索へ戻る
        </Link>
      </div>

      {/* サマリー（箱なし・和紙地に直接） */}
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          {player.displayName}
          {currentGrade && (
            <span className="ml-2 align-baseline text-base font-normal text-ink-meta">
              （{currentGrade}級）
            </span>
          )}
        </h1>
        {participations[0]?.affiliation && (
          <div className="mt-0.5 text-xs text-ink-meta">
            {participations[0].affiliation}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] tracking-wide text-ink-meta">通算</span>
            <span className="font-display text-2xl font-bold">
              <span className="text-success-fg">{totalWins}</span>
              <span className="text-[13px] text-ink-muted">勝</span>
              <span className="text-danger-fg">{totalLosses}</span>
              <span className="text-[13px] text-ink-muted">敗</span>
            </span>
          </div>
          {winRate != null && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] tracking-wide text-ink-meta">勝率</span>
              <span className="font-display text-2xl font-bold text-brand">
                {winRate}
                <span className="text-sm">%</span>
              </span>
            </div>
          )}
        </div>

        <div className="mt-2 text-xs text-ink-meta">{chips.join(' ・ ')}</div>
      </div>

      <hr className="border-t border-border-soft" />

      {years.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-meta">出場記録がありません。</p>
      ) : (
        <SensekiTimeline years={years} />
      )}
    </div>
  )
}
