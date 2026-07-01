import { and, asc, desc, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  matches,
  players,
  tournamentClasses,
  tournamentParticipants,
  tournaments,
} from '@kagetra/shared/schema'
import {
  coerceRankingMetric,
  sanitizeStatsFilter,
  type RankingMetric,
  type StatsFilter,
} from './types'

// RankingMetric は共有型（types.ts）で定義。従来 `@/lib/stats/ranking` から import して
// いた箇所を壊さないよう、取り込んだ型をそのまま再エクスポートする。
export type { RankingMetric }

export interface RankingRow {
  /** 競技ランキング順位（同値=同順位・タイの次は順位を飛ばす。3人が1位タイ→次は4位）。 */
  rank: number
  playerId: number
  displayName: string
  /** 直近大会（event_date 降順 NULLS LAST・同日 id 降順）の participant 所属。未参加は null。 */
  affiliation: string | null
  /** 指標値（勝率は 0–100 の小数第1位、他は整数）。 */
  value: number
  /** 副次表示用の補助数値。勝率のみ母数（対戦数）を返し、他の指標は null。 */
  sub: number | null
}

export interface PlayerRankingResult {
  rows: RankingRow[]
  /** フィルタ該当選手の総数（＝見出し「該当N人」・ページングの母数。offset に依存しない全体値）。 */
  total: number
}

/** 勝率の足切り（最低対戦数）。requirements §3.5。 */
const WIN_RATE_MIN_MATCHES = 20
const DEFAULT_LIMIT = 100

/**
 * 期間・級フィルタの WHERE 断片。tournaments / tournament_classes を join 済みの
 * クエリで使う。year 指定時は event_date の日付比較になり、event_date 無し大会は
 * 自然に除外される（NULL 比較が偽）。grades は enum 列への IN（未指定なら無条件）。
 */
function filterConds(filter: StatsFilter): SQL[] {
  const conds: SQL[] = []
  if (filter.yearFrom != null) {
    conds.push(sql`${tournaments.eventDate} >= ${`${filter.yearFrom}-01-01`}::date`)
  }
  if (filter.yearTo != null) {
    conds.push(sql`${tournaments.eventDate} <= ${`${filter.yearTo}-12-31`}::date`)
  }
  if (filter.grades && filter.grades.length > 0) {
    conds.push(inArray(tournamentClasses.grade, filter.grades))
  }
  return conds
}

/**
 * 直近大会（event_date 降順 NULLS LAST・同日は tournament id 降順）の participant 所属。
 * searchPlayers（[[impl_player_search_recent_affiliation]]）と同一ロジック＝戦績詳細
 * ヘッダ・検索結果・ランキングで所属表示が一致する。
 */
function recentAffiliation(playerIdCol: SQLWrapper): SQL<string | null> {
  return sql<string | null>`(
    select tp.affiliation
    from ${tournamentParticipants} tp
    join ${tournamentClasses} tc on tc.id = tp.class_id
    join ${tournaments} t on t.id = tc.tournament_id
    where tp.player_id = ${playerIdCol}
    order by t.event_date desc nulls last, t.id desc
    limit 1
  )`
}

/** 参加グレイン（tournament_participants 起点）の集計サブクエリ。優勝/入賞/出場で使う。 */
function participantAgg(
  filter: StatsFilter,
  valueSql: SQL<number>,
  subSql: SQL<number | null>,
  havingSql: SQL,
) {
  return db
    .select({
      playerId: sql<number>`${players.id}`.as('player_id'),
      displayName: sql<string>`${players.displayName}`.as('display_name'),
      value: valueSql.as('value'),
      sub: subSql.as('sub'),
    })
    .from(tournamentParticipants)
    .innerJoin(players, eq(players.id, tournamentParticipants.playerId))
    .innerJoin(tournamentClasses, eq(tournamentClasses.id, tournamentParticipants.classId))
    .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
    .where(and(...filterConds(filter)))
    .groupBy(players.id)
    .having(havingSql)
    .as('agg')
}

/** 対戦グレイン（matches 起点）の集計サブクエリ。勝利/対戦/勝率で使う。 */
function matchAgg(
  filter: StatsFilter,
  valueSql: SQL<number>,
  subSql: SQL<number | null>,
  havingSql: SQL,
) {
  return db
    .select({
      playerId: sql<number>`${players.id}`.as('player_id'),
      displayName: sql<string>`${players.displayName}`.as('display_name'),
      value: valueSql.as('value'),
      sub: subSql.as('sub'),
    })
    .from(matches)
    .innerJoin(
      tournamentParticipants,
      and(
        eq(tournamentParticipants.id, matches.participantId),
        eq(tournamentParticipants.classId, matches.classId),
      ),
    )
    .innerJoin(players, eq(players.id, tournamentParticipants.playerId))
    .innerJoin(tournamentClasses, eq(tournamentClasses.id, matches.classId))
    .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
    .where(and(...filterConds(filter)))
    .groupBy(players.id)
    .having(havingSql)
    .as('agg')
}

// 集計式の断片（SELECT と HAVING で同一式を使い回すため定数化＝alias は HAVING で参照不可）。
const NORMAL_WINS = sql`count(*) filter (where ${matches.result} = 'win' and ${matches.status} = 'normal')`
const NORMAL_GAMES = sql`count(*) filter (where ${matches.status} = 'normal')`
const CHAMPIONS = sql`count(*) filter (where ${tournamentParticipants.derivedBracket} = 1)`
const NYUSHO = sql`count(*) filter (where ${tournamentParticipants.derivedBracket} <= 8)`
const NO_SUB = sql<number | null>`null`

/** 指標に応じた集計サブクエリ（value / sub / HAVING を切り替える）。 */
function aggFor(metric: RankingMetric, filter: StatsFilter) {
  switch (metric) {
    case 'participations':
      return participantAgg(filter, sql<number>`count(*)::int`, NO_SUB, sql`count(*) > 0`)
    case 'championships':
      return participantAgg(filter, sql<number>`${CHAMPIONS}::int`, NO_SUB, sql`${CHAMPIONS} > 0`)
    case 'nyusho':
      return participantAgg(filter, sql<number>`${NYUSHO}::int`, NO_SUB, sql`${NYUSHO} > 0`)
    case 'wins':
      return matchAgg(filter, sql<number>`${NORMAL_WINS}::int`, NO_SUB, sql`${NORMAL_WINS} > 0`)
    case 'matches':
      return matchAgg(filter, sql<number>`${NORMAL_GAMES}::int`, NO_SUB, sql`${NORMAL_GAMES} > 0`)
    case 'winRate':
      // 勝率＝normal の勝ち/対戦（小数第1位）。母数は最低20試合で足切り（HAVING）。
      // 母数0はHAVINGで弾かれるが、念のため nullif でゼロ除算を防ぐ。
      return matchAgg(
        filter,
        sql<number>`round(100.0 * ${NORMAL_WINS} / nullif(${NORMAL_GAMES}, 0), 1)::float8`,
        sql<number>`${NORMAL_GAMES}::int`,
        sql`${NORMAL_GAMES} >= ${WIN_RATE_MIN_MATCHES}`,
      )
  }
}

/**
 * 指標別の選手ランキング（読み取り専用・サーバー集計）。requirements §3.5 / §4.2。
 *
 * 集計サブクエリ（フィルタ・HAVING 済み）を FROM に、`rank() over (order by value desc)`
 * で競技ランキング順位（タイの次は飛ばす）を、`count(*) over ()` で該当総数を、相関
 * サブクエリで直近所属を1回のクエリで取る。並びは値降順→表示名昇順。TOP `limit` を offset で
 * ページング（「もっと見る」）。優勝/入賞は事前計算列 derived_bracket を数える（§4.1）。
 */
export async function getPlayerRanking(
  metric: RankingMetric,
  filter: StatsFilter = {},
  limit = DEFAULT_LIMIT,
  offset = 0,
): Promise<PlayerRankingResult> {
  // データアクセスの choke point で入力を丸める（全呼び出し元＝ページ/Server Action が
  // ここを通る防御）。信頼できない Server Action ペイロード（改変された metric/filter/offset）
  // でも aggFor が undefined を返したり DB エラー（enum 外 grade・負 offset・NaN 年）で 500 に
  // ならないよう、許可リスト/範囲へ丸めてから集計する。
  const safeMetric = coerceRankingMetric(metric)
  const safeFilter = sanitizeStatsFilter(filter)
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, DEFAULT_LIMIT) : DEFAULT_LIMIT
  const agg = aggFor(safeMetric, safeFilter)

  const rows = await db
    .select({
      playerId: agg.playerId,
      displayName: agg.displayName,
      value: agg.value,
      sub: agg.sub,
      rank: sql<number>`cast(rank() over (order by ${agg.value} desc) as int)`,
      total: sql<number>`cast(count(*) over () as int)`,
      affiliation: recentAffiliation(agg.playerId),
    })
    .from(agg)
    // 値降順→表示名昇順→player_id 昇順。最後の player_id は同値同名でも並びを一意に
    // 固定し、offset ページング（「もっと見る」）で境界の重複/欠落が起きないようにする。
    .orderBy(desc(agg.value), asc(agg.displayName), asc(agg.playerId))
    .limit(safeLimit)
    .offset(safeOffset)

  return {
    rows: rows.map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      displayName: r.displayName,
      affiliation: r.affiliation,
      value: r.value,
      sub: r.sub,
    })),
    total: rows[0]?.total ?? 0,
  }
}
