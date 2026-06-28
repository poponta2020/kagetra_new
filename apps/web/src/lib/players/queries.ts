import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  matches,
  players,
  tournamentParticipants,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'
import {
  derivePlacement,
  isChampion,
  isNyusho,
  type PlacementMatch,
} from './placement'

export interface PlayerSearchResult {
  id: number
  displayName: string
  affiliation: string | null
  prefecture: string | null
  participationCount: number
}

export interface PlayerMatchView {
  round: number
  roundLabel: string | null
  opponentName: string | null
  /**
   * 相手が同一級で player に解決できた場合のみ、その player_id（戦績へのリンク先・R1）。
   * 未解決の生名／本人を指す場合は null（リンクにしない）。
   */
  opponentPlayerId: number | null
  scoreDiff: number | null
  result: 'win' | 'lose'
  status: 'normal' | 'walkover' | 'forfeit'
}

export interface PlayerParticipationView {
  participantId: number
  tournamentId: number
  tournamentName: string
  eventDate: string | null
  className: string
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  /** その大会での所属（participant の生スナップショット）。player は所属を持たないのでここが正。 */
  affiliation: string | null
  /** 原本の順位（自由記述）。導出できない級のフォールバック元。 */
  finalRank: string | null
  /** 表示順位：対戦から導出（優勝/準優勝/ベストN）。導出不能なら finalRank にフォールバック。 */
  rank: string | null
  /** 導出順位の bracket（1=優勝, 2=準優勝, 4, 8, …）。フォールバック時は null。bracket<=2 を強調表示に使う。 */
  rankBracket: number | null
  matches: PlayerMatchView[]
}

export interface PlayerRecord {
  player: {
    id: number
    displayName: string
    affiliation: string | null
    prefecture: string | null
  }
  participations: PlayerParticipationView[]
  /** 勝ち数：status=normal の win のみ（不戦勝・棄権は含めない）。 */
  totalWins: number
  /** 負け数：status=normal の lose のみ。 */
  totalLosses: number
  /** 優勝回数：対戦から導出した bracket=1 の数（導出不能な級は数えない）。 */
  championships: number
  /** 入賞回数：導出 bracket<=8（ベスト8以上）の数。 */
  nyushoCount: number
  /** 出場大会数（participation 数）。 */
  tournamentCount: number
  /** 活動年スパン：event_date のある参加の最小〜最大年。無ければ null。 */
  activeYears: { from: number; to: number } | null
  /** 現在の級：最新参加（開催日降順で最初）の非 null grade。 */
  currentGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null
}

/**
 * 選手名検索。入力を normalizePlayerName で正規化（空白除去・NFKC・字体揺れ吸収）
 * してから normalized_name の部分一致で引く。これにより「田中 太郎」でも
 * 「田中太郎」がヒットする。空クエリは空配列。
 */
export async function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
  const normalized = normalizePlayerName(query.trim())
  if (!normalized) return []

  // LIKE のワイルドカード（% _）はエスケープ。normalizePlayerName は空白を除去
  // するが記号は残すため、ユーザー入力由来の % / _ を literal 扱いにする。
  const escaped = normalized.replace(/([%_\\])/g, '\\$1')

  const rows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      affiliation: players.affiliation,
      prefecture: players.prefecture,
      participationCount: sql<number>`count(${tournamentParticipants.id})::int`,
    })
    .from(players)
    .leftJoin(tournamentParticipants, eq(tournamentParticipants.playerId, players.id))
    .where(like(players.normalizedName, sql`'%' || ${escaped} || '%'`))
    .groupBy(players.id)
    .orderBy(desc(sql`count(${tournamentParticipants.id})`), players.displayName)
    .limit(50)

  return rows
}

/**
 * 選手の全戦績。participants（生スナップショット）を起点に大会/級/順位/各試合を
 * 読み取り専用で集約する。
 * - 勝敗数は matches の status=normal のみから導出。
 * - 各大会の順位は対戦結果から導出（derivePlacement）。導出不能な級は保存 final_rank に
 *   フォールバック（requirements R1 / design-spec §6）。
 * - 各試合の相手は同一級で解決できていればその player_id を持たせ、戦績リンクに使う。
 */
export async function getPlayerRecord(playerId: number): Promise<PlayerRecord | null> {
  const player = await db.query.players.findFirst({
    where: eq(players.id, playerId),
    columns: {
      id: true,
      displayName: true,
      affiliation: true,
      prefecture: true,
    },
  })
  if (!player) return null

  const participantRows = await db.query.tournamentParticipants.findMany({
    where: eq(tournamentParticipants.playerId, playerId),
    columns: {
      id: true,
      classId: true,
      affiliation: true,
      finalRank: true,
    },
    with: {
      class: {
        columns: { className: true, grade: true },
        with: {
          tournament: {
            columns: { id: true, name: true, eventDate: true },
          },
        },
      },
      matches: {
        columns: {
          round: true,
          roundLabel: true,
          opponentName: true,
          opponentParticipantId: true,
          scoreDiff: true,
          result: true,
          status: true,
        },
      },
    },
  })

  // 順位導出に必要な「級の決勝 round」＝級内 max(round) を一括取得。
  const classIds = [...new Set(participantRows.map((p) => p.classId))]
  const maxRoundRows = classIds.length
    ? await db
        .select({
          classId: matches.classId,
          maxRound: sql<number>`max(${matches.round})::int`,
        })
        .from(matches)
        .where(inArray(matches.classId, classIds))
        .groupBy(matches.classId)
    : []
  const maxRoundByClass = new Map(maxRoundRows.map((r) => [r.classId, r.maxRound]))

  // 相手 participant → player_id を一括解決（戦績リンク用・R1）。
  const opponentPartIds = [
    ...new Set(
      participantRows.flatMap((p) =>
        p.matches
          .map((m) => m.opponentParticipantId)
          .filter((x): x is number => x != null),
      ),
    ),
  ]
  const opponentRows = opponentPartIds.length
    ? await db
        .select({ id: tournamentParticipants.id, playerId: tournamentParticipants.playerId })
        .from(tournamentParticipants)
        .where(inArray(tournamentParticipants.id, opponentPartIds))
    : []
  const playerIdByPart = new Map<number, number | null>(
    opponentRows.map((r) => [r.id, r.playerId]),
  )

  let championships = 0
  let nyushoCount = 0
  const participations: PlayerParticipationView[] = participantRows.map((p) => {
    const sorted = [...p.matches].sort((a, b) => a.round - b.round)
    const placementMatches: PlacementMatch[] = sorted.map((m) => ({
      round: m.round,
      roundLabel: m.roundLabel,
      result: m.result,
      status: m.status,
    }))
    const classMaxRound =
      maxRoundByClass.get(p.classId) ??
      (placementMatches.length ? Math.max(...placementMatches.map((m) => m.round)) : 0)
    const derived = derivePlacement(placementMatches, classMaxRound)
    if (isChampion(derived)) championships++
    if (isNyusho(derived)) nyushoCount++

    return {
      participantId: p.id,
      tournamentId: p.class.tournament.id,
      tournamentName: p.class.tournament.name,
      eventDate: p.class.tournament.eventDate,
      className: p.class.className,
      grade: p.class.grade,
      affiliation: p.affiliation,
      finalRank: p.finalRank,
      rank: derived?.label ?? p.finalRank,
      rankBracket: derived?.bracket ?? null,
      matches: sorted.map((m) => {
        const oppPid =
          m.opponentParticipantId != null
            ? (playerIdByPart.get(m.opponentParticipantId) ?? null)
            : null
        return {
          round: m.round,
          roundLabel: m.roundLabel,
          opponentName: m.opponentName,
          // 本人を指す解決は除外（R1 境界）。
          opponentPlayerId: oppPid != null && oppPid !== playerId ? oppPid : null,
          scoreDiff: m.scoreDiff,
          result: m.result,
          status: m.status,
        }
      }),
    }
  })

  // Sort participations by event_date desc (null dates last), then tournament name.
  participations.sort((a, b) => {
    if (a.eventDate && b.eventDate) return b.eventDate.localeCompare(a.eventDate)
    if (a.eventDate) return -1
    if (b.eventDate) return 1
    return a.tournamentName.localeCompare(b.tournamentName)
  })

  // サマリー：活動年スパン（event_date の年）と現在の級（最新の非 null grade）。
  const years = participations
    .map((p) => p.eventDate)
    .filter((d): d is string => !!d)
    .map((d) => Number(d.slice(0, 4)))
    .filter((y) => !Number.isNaN(y))
  const activeYears =
    years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null
  const currentGrade = participations.find((p) => p.grade != null)?.grade ?? null

  // 勝敗数は status=normal のみ。DB 側で集計して導出する。
  const [agg] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${matches.result} = 'win' and ${matches.status} = 'normal')::int`,
      losses: sql<number>`count(*) filter (where ${matches.result} = 'lose' and ${matches.status} = 'normal')::int`,
    })
    .from(matches)
    .innerJoin(
      tournamentParticipants,
      and(
        eq(matches.participantId, tournamentParticipants.id),
        eq(matches.classId, tournamentParticipants.classId),
      ),
    )
    .where(eq(tournamentParticipants.playerId, playerId))

  return {
    player,
    participations,
    totalWins: agg?.wins ?? 0,
    totalLosses: agg?.losses ?? 0,
    championships,
    nyushoCount,
    tournamentCount: participations.length,
    activeYears,
    currentGrade,
  }
}
