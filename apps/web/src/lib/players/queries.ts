import { and, desc, eq, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  matches,
  players,
  tournamentParticipants,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'

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
  finalRank: string | null
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
 * 読み取り専用で集約。勝敗数は matches の status=normal のみから導出（要件 §3.4）。
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
          scoreDiff: true,
          result: true,
          status: true,
        },
      },
    },
  })

  const participations: PlayerParticipationView[] = participantRows.map((p) => ({
    participantId: p.id,
    tournamentId: p.class.tournament.id,
    tournamentName: p.class.tournament.name,
    eventDate: p.class.tournament.eventDate,
    className: p.class.className,
    grade: p.class.grade,
    finalRank: p.finalRank,
    matches: [...p.matches]
      .sort((a, b) => a.round - b.round)
      .map((m) => ({
        round: m.round,
        roundLabel: m.roundLabel,
        opponentName: m.opponentName,
        scoreDiff: m.scoreDiff,
        result: m.result,
        status: m.status,
      })),
  }))

  // Sort participations by event_date desc (null dates last), then tournament name.
  participations.sort((a, b) => {
    if (a.eventDate && b.eventDate) return b.eventDate.localeCompare(a.eventDate)
    if (a.eventDate) return -1
    if (b.eventDate) return 1
    return a.tournamentName.localeCompare(b.tournamentName)
  })

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
  }
}
