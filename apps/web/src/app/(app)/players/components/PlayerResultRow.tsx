import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { PlayerSearchResult } from '@/lib/players/queries'
import { formatTournamentLabel } from '@/lib/players/tournamentLabel'

/**
 * 最終出場が「引退の気配」に見えるまで古いと判定する境界年数。現在年から数えて
 * この年数**以上**前（＝ちょうど OLD_YEARS 年前も含む・下の `year <= nowYear - OLD_YEARS`）
 * なら年月をミュート（砂色）表示する。design-spec §9 のユーザー確定値＝10 年（承認済み
 * モック準拠：2026 年基準では 2016 年以前を薄く・2017 年以降は通常表示。モックも 2016 は
 * 薄く／2019・2021 は通常）。
 */
const OLD_YEARS = 10

/** "YYYY-MM-DD" → "YYYY/MM"。null は「開催日不明」。 */
function formatYearMonth(eventDate: string | null): string {
  if (!eventDate) return '開催日不明'
  return `${eventDate.slice(0, 4)}/${eventDate.slice(5, 7)}`
}

/**
 * 選手検索の結果 1 件（design-spec §3.1・方向性A）。枠なしの密なリスト行。
 *
 * grid [1fr | 出場大会数(auto) | ›(12px)]。行タップで戦績詳細 `/players/{id}` へ。
 * - 左 1 行目：氏名（serif 700）＋現級 `(A)`（同 serif で一体）＋所属会（sans meta）。
 * - 左 2 行目：最終出場を 1 行集約「最終出場：YYYY/MM（大会名 結果）」。
 *   入賞（優勝/準優勝/ベストN・生 final_rank）＝藍、記録なし＝砂ミュート、古い年月＝砂。
 * - 右：出場大会数。末尾：chevron。
 *
 * すべての文字列は省略記号で 1 行に収める（375px 基準・横スクロールを作らない）。
 * `nowYear` は呼び出し側（page）で 1 度だけ算出して渡す＝全行で同じ現在年を使い、
 * 行ごとに時刻を読まない（描画の一貫性）。
 */
export function PlayerResultRow({
  player,
  nowYear,
}: {
  player: PlayerSearchResult
  nowYear: number
}) {
  const yearMonth = formatYearMonth(player.lastEventDate)
  const year = player.lastEventDate ? Number(player.lastEventDate.slice(0, 4)) : null
  // 開催日不明（year=null）も「気配なし＝薄く」側に倒す。
  const isOld = year === null || year <= nowYear - OLD_YEARS
  const hasResult = player.lastResult != null && player.lastResult !== ''

  return (
    <Link
      href={`/players/${player.id}`}
      className="grid grid-cols-[1fr_auto_12px] items-center gap-2.5 px-4 py-[11px]"
    >
      {/* 左：氏名（級）＋所属 / 最終出場 1 行集約 */}
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-px">
          <b className="min-w-0 shrink truncate font-display text-[19px] font-bold tracking-[0.01em] text-ink">
            {player.displayName}
          </b>
          {player.currentGrade && (
            <span className="shrink-0 whitespace-nowrap font-display text-[19px] font-bold tracking-[0.01em] text-ink">
              ({player.currentGrade})
            </span>
          )}
          <span className="ml-2 min-w-0 shrink truncate text-[11.5px] text-ink-meta">
            {player.affiliation ?? '所属不明'}
          </span>
        </span>
        <span className="mt-[3px] block truncate text-[10.5px] text-ink-muted">
          {player.lastTournamentName ? (
            <>
              最終出場：
              <span
                className={cn(
                  'font-display font-semibold',
                  isOld ? 'text-ink-muted' : 'text-ink-meta',
                )}
              >
                {yearMonth}
              </span>
              （
              {formatTournamentLabel({
                name: player.lastTournamentName,
                shortName: player.lastShortName,
                grade: player.lastGrade,
              })}{' '}
              <span
                className={cn(
                  hasResult ? 'font-semibold text-brand-fg' : 'font-normal text-ink-muted',
                )}
              >
                {hasResult ? player.lastResult : '記録なし'}
              </span>
              ）
            </>
          ) : (
            <span className="text-ink-muted">出場記録なし</span>
          )}
        </span>
      </span>

      {/* 右：出場大会数 */}
      <span className="whitespace-nowrap text-right">
        <span className="block text-[9.5px] tracking-[0.02em] text-ink-muted">出場大会数</span>
        <span className="block font-display text-[16px] font-semibold text-ink-2">
          {player.participationCount}
          <small className="ml-px text-[10px] font-normal text-ink-muted">大会</small>
        </span>
      </span>

      <span className="text-center text-[17px] text-ink-muted">›</span>
    </Link>
  )
}
