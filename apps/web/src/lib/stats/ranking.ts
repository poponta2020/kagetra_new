import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  matches,
  players,
  tournamentClasses,
  tournamentParticipants,
  tournaments,
} from '@kagetra/shared/schema'
import { periodConds } from './filters'
import {
  DEFAULT_WIN_RATE_MIN_MATCHES,
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
 * ⑤現級母集団の制限断片。**級フィルタ有り＋トグルOFF**（`includeFormerGrade` 偽）のときだけ
 * 「**現級 ∈ 選択級**」の選手に母集団を絞る `players.id IN (...)` を1枚返す（他は undefined）。
 * 成績の数え方（`filterConds` の grade IN＝分子/分母）は不変で、ここは「誰を載せるか」だけを変える。
 *
 * 現級＝**期間フィルタ内・判明級（grade IS NOT NULL）のみ**の直近1件の grade。非相関の
 * DISTINCT ON サブクエリで選手ごと現級を1パスで畳み（選手ごと相関＝数万回スキャンを避ける）、
 * その grade が選択級かを判定する。並びは所属解決・⑤現級で共通の event_date DESC NULLS LAST, id DESC。
 *
 * - 落とし穴①: 現級サブクエリの WHERE に **選択級（grade IN）を入れない**。入れると「級Xを
 *   打った最新の参加」を拾い「最新の参加がたまたま級X」にならない。判明級の最新1件→grade 判定の順。
 * - 落とし穴②: 生 SQL は tournaments を `t` にエイリアスするため drizzle の `tournaments.eventDate`
 *   を流用できない。期間条件は `filters.periodConds`（t alias 版・「AND t.event_date …」）で組む。
 *
 * ③（優勝者除外）: B〜E級は優勝すると必ず昇段するドメインルールがある。現級を決めた「直近参加
 * そのもの」で優勝（`derived_bracket = 1`）した B〜E級選手は、まだ次の大会に出ておらず旧級に
 * 残っているだけなので母集団から除外する。DISTINCT ON で現級を畳む際に `derived_bracket` も同じ
 * 行から取り、外側 WHERE で除外する。A級は優勝しても昇段しないため対象外。優勝定義は優勝回数
 * ランキングと同一（derived_bracket=1）で、ブラケット導出不能（null）の優勝は除外しない。
 */
function currentGradeMembership(filter: StatsFilter): SQL | undefined {
  const grades = filter.grades
  if (!grades || grades.length === 0 || filter.includeFormerGrade) return undefined
  const period = periodConds(filter)
  const gradeList = sql.join(
    grades.map((g) => sql`${g}`),
    sql`, `,
  )
  return sql`${players.id} in (
    select player_id from (
      select distinct on (tp.player_id) tp.player_id as player_id, tc.grade as grade,
        tp.derived_bracket as derived_bracket
      from tournament_participants tp
      join tournament_classes tc on tc.id = tp.class_id
      join tournaments t on t.id = tc.tournament_id
      where tc.grade is not null ${period}
      order by tp.player_id, t.event_date desc nulls last, t.id desc
    ) cur
    where cur.grade::text in (${gradeList})
      -- ③ 直近参加そのもので優勝した B〜E級選手（昇段確定＝旧級に残っているだけ）を除外。
      -- derived_bracket が null（ブラケット導出不能）の参加は「優勝と確定できない」ため
      -- coalesce で false 扱い＝母集団に残す（優勝回数ランキングと同じ割り切り）。null を
      -- そのまま = 1 判定すると NOT(true AND null)=null で null 級の非優勝者まで落ちる。
      and not (
        cur.grade::text in ('B', 'C', 'D', 'E')
        and coalesce(cur.derived_bracket = 1, false)
      )
  )`
}

/**
 * ランキング各行の所属会を、集計後に playerId 群 →「期間フィルタ内の直近大会」（event_date
 * 降順 NULLS LAST・同日は tournament id 降順・級不問）の participant 所属で一括解決してマップで返す。
 *
 * 以前は派生テーブル `agg` の列に相関する相関サブクエリ（`recentAffiliation(agg.playerId)`）で
 * 引いていたが、派生列への相関が効かず **全行が同じ所属** になるバグがあった（テストが1人しか
 * seed せず未検出＝テストギャップ）。`queries.ts` の相手所属解決と同型（行取得後に id 群を別
 * クエリで一括解決）に寄せて集計本体を汚さず複数選手でも正しく解く。直近判定は現在の期間
 * フィルタ内に限定（全期間なら通算直近）。級では絞らない（期間内・級不問の直近1件）。
 */
async function resolveRecentAffiliations(
  playerIds: number[],
  filter: StatsFilter,
): Promise<Map<number, string | null>> {
  if (playerIds.length === 0) return new Map()
  // filters.ts の periodConds は生 SQL（t alias）用に「AND t.event_date …」を返す（フィルタ
  // 無しなら空 SQL＝通算直近）。DISTINCT ON で選手ごと直近1件を取る（並びは所属表示と ⑤現級
  // 判定で共通の event_date DESC NULLS LAST, id DESC）。
  const period = periodConds(filter)
  const ids = sql.join(
    playerIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const res = await db.execute(sql`
    SELECT DISTINCT ON (tp.player_id) tp.player_id AS player_id, tp.affiliation AS affiliation
    FROM tournament_participants tp
    JOIN tournament_classes tc ON tc.id = tp.class_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE tp.player_id = ANY(ARRAY[${ids}]::int[]) ${period}
    ORDER BY tp.player_id, t.event_date DESC NULLS LAST, t.id DESC
  `)
  const map = new Map<number, string | null>()
  for (const row of res.rows as Record<string, unknown>[]) {
    map.set(Number(row.player_id), (row.affiliation as string | null) ?? null)
  }
  return map
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
    .where(and(...filterConds(filter), ...membershipConds(filter)))
    .groupBy(players.id)
    .having(havingSql)
    .as('agg')
}

/** ⑤現級母集団の制限（発火時のみ 1 要素、非発火は空）を条件配列で返す。 */
function membershipConds(filter: StatsFilter): SQL[] {
  const membership = currentGradeMembership(filter)
  return membership ? [membership] : []
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
    .where(and(...filterConds(filter), ...membershipConds(filter)))
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
    case 'winRate': {
      // 勝率＝normal の勝ち/対戦（小数第1位）。母数は最低試合数で足切り（HAVING）。
      // 既定 20・④で filter.minMatches（1〜1000 クランプ済み）が来ればそれを使う。他指標は
      // minMatches を参照しない。母数0はHAVINGで弾かれるが、念のため nullif でゼロ除算を防ぐ。
      const minMatches = filter.minMatches ?? DEFAULT_WIN_RATE_MIN_MATCHES
      return matchAgg(
        filter,
        sql<number>`round(100.0 * ${NORMAL_WINS} / nullif(${NORMAL_GAMES}, 0), 1)::float8`,
        sql<number>`${NORMAL_GAMES}::int`,
        sql`${NORMAL_GAMES} >= ${minMatches}`,
      )
    }
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
    })
    .from(agg)
    // 値降順→表示名昇順→player_id 昇順。最後の player_id は同値同名でも並びを一意に
    // 固定し、offset ページング（「もっと見る」）で境界の重複/欠落が起きないようにする。
    .orderBy(desc(agg.value), asc(agg.displayName), asc(agg.playerId))
    .limit(safeLimit)
    .offset(safeOffset)

  // total は `count(*) over ()`＝offset 非依存の全体件数だが、offset が末尾を超える等で
  // このページに 1 行も返らないと窓の値が取れない。契約（offset 非依存）を守るため、その
  // ときだけ agg を数え直す（GROUP BY の行数＝該当選手数）。通常（offset=0 等 rows あり）は
  // 追加クエリ無しで rows[0].total を使う。
  let total = rows[0]?.total ?? 0
  if (rows.length === 0) {
    const countAgg = aggFor(safeMetric, safeFilter)
    const [c] = await db
      .select({ n: sql<number>`cast(count(*) as int)` })
      .from(countAgg)
    total = c?.n ?? 0
  }

  // 所属会は集計後に別クエリで一括解決してマージ（②バグ修正）。相関サブクエリを派生列に
  // 当てると全行同じ所属になるため。期間フィルタ内の直近1件（級不問）を使う。
  const affiliations = await resolveRecentAffiliations(
    rows.map((r) => r.playerId),
    safeFilter,
  )

  return {
    rows: rows.map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      displayName: r.displayName,
      affiliation: affiliations.get(r.playerId) ?? null,
      value: r.value,
      sub: r.sub,
    })),
    total,
  }
}
