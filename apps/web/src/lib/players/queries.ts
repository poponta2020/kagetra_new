import { and, desc, eq, inArray, isNotNull, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  matches,
  players,
  tournamentClasses,
  tournamentParticipants,
  tournaments,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'
import { filterConds } from '@/lib/stats/ranking'
import type { StatsFilter } from '@/lib/stats/types'
import {
  derivePlacement,
  isChampion,
  isDerivableClass,
  isNyusho,
  labelForBracket,
  type PlacementMatch,
} from './placement'

export interface PlayerSearchResult {
  id: number
  displayName: string
  affiliation: string | null
  prefecture: string | null
  participationCount: number
  /**
   * 現級：最新参加（event_date 降順 NULLS LAST・同日は tournament id 降順）のうち
   * **非 null な** `tournament_classes.grade`。詳細画面 `PlayerRecord.currentGrade` と
   * 同定義（絶対的直近参加の grade が null でも遡って非 null を拾う）。
   */
  currentGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  /** 最終出場（＝直近参加 1 件）の大会開催日。null＝開催日不明。 */
  lastEventDate: string | null
  /** 最終出場の大会名。参加がなければ null。 */
  lastTournamentName: string | null
  /**
   * 最終出場の結果表示：①導出 `derived_bracket`→ラベル（優勝/準優勝/ベストN）
   * ②生 `final_rank`（例「3位」）③どちらも無ければ null（＝記録なし）。詳細画面の
   * `rank` と単一ソース（`derived_bracket` は materialize 時に `derivePlacement` で確定）。
   */
  lastResult: string | null
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
  /** 相手のその大会での所属会（opponent participant の affiliation）。未解決は null。 */
  opponentAffiliation: string | null
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
  /** 現在の級：最新参加（開催日降順で最初）の非 null grade。絞り込み時も全成績ベース。 */
  currentGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  /**
   * ヘッダ所属：直近大会（event_date 降順 NULLS LAST・同日 id 降順）の participant 所属。
   * player は所属を持たないのでここが正。**絞り込み時も全成績ベース**（identity は絞り込み
   * 条件で変えない）。全出場が無ければ null。
   */
  currentAffiliation: string | null
}

/** getPlayerRecord のドリルダウン絞り込みオプション（?from=ranking 由来のときのみ渡す）。 */
export interface GetPlayerRecordOptions {
  /**
   * ①期間＋級の絞り込み（`yearFrom` / `yearTo` / `grades` のみ使用）。指定時のみ絞り込み
   * モードになり、一覧・ヘッダ集計・勝敗を①母集合で再計算する。条件式はランキング集計
   * （`ranking.ts` の `filterConds`）と同一関数＝セマンティクス単一ソース。
   */
  filter?: StatsFilter
  /**
   * ②一覧（participations）をさらに優勝（`1`）／入賞（`8`＝ベスト8以上）した参加のみに絞る。
   * **一覧の id 絞りにのみ**適用し、ヘッダ集計（優勝 N・入賞 N・勝敗等）は①母集合のまま。
   * 判定は事前計算列 `derived_bracket`（優勝/入賞回数ランキングと単一定義）。
   */
  bracketAtMost?: 1 | 8
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

  // 「直近参加 1 件」（event_date 降順 NULLS LAST・同日は tournament id 降順）の
  // スナップショットを LATERAL で一括取得する。所属会・最終出場（開催日/大会名）・
  // 結果導出元（derived_bracket / final_rank）を同じ 1 行から引くので、相関スカラ
  // サブクエリを列ごとに並べずに済み、直近 1 件の同定基準が全列で必ず一致する。
  // 詳細画面ヘッダ（participations[0]）と同じ 1 件を指すため所属表示も一致する。
  const latest = db
    .select({
      affiliation: tournamentParticipants.affiliation,
      derivedBracket: tournamentParticipants.derivedBracket,
      finalRank: tournamentParticipants.finalRank,
      eventDate: tournaments.eventDate,
      tournamentName: tournaments.name,
    })
    .from(tournamentParticipants)
    .innerJoin(tournamentClasses, eq(tournamentClasses.id, tournamentParticipants.classId))
    .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
    .where(eq(tournamentParticipants.playerId, players.id))
    .orderBy(sql`${tournaments.eventDate} desc nulls last`, desc(tournaments.id))
    .limit(1)
    .as('latest')

  // 出場大会数（participation 数）。LATERAL とは別粒度なのでスカラサブクエリで数える。
  const participationCount = sql<number>`(
    select count(*)::int from ${tournamentParticipants} tp where tp.player_id = ${players.id}
  )`

  // 現級＝最新参加のうち **grade が非 null** の直近 1 件（詳細画面 currentGrade と同定義）。
  // last* の「絶対的直近 1 件」とは条件が違う（直近参加の grade が null の場合、last* は
  // その参加を指すが currentGrade はさらに遡って非 null grade を拾う）ため別サブクエリ。
  const currentGrade = sql<'A' | 'B' | 'C' | 'D' | 'E' | null>`(
    select tc.grade
    from ${tournamentParticipants} tp
    join ${tournamentClasses} tc on tc.id = tp.class_id
    join ${tournaments} t on t.id = tc.tournament_id
    where tp.player_id = ${players.id} and tc.grade is not null
    order by t.event_date desc nulls last, t.id desc
    limit 1
  )`

  const rows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      prefecture: players.prefecture,
      affiliation: latest.affiliation,
      lastEventDate: latest.eventDate,
      lastTournamentName: latest.tournamentName,
      lastBracket: latest.derivedBracket,
      lastFinalRank: latest.finalRank,
      participationCount,
      currentGrade,
    })
    .from(players)
    .leftJoinLateral(latest, sql`true`)
    .where(like(players.normalizedName, sql`'%' || ${escaped} || '%'`))
    // 並びは最終出場が新しい順（現役が上）＝ lastEventDate 降順 NULLS LAST が主キー。
    // 開催日不明（null）は主キーで常に最後尾グループに落ちる（現役を優先＝日付あり行を
    // null 行が出場大会数で追い越すことはない）。第2・第3キーの「出場大会数降順→表示名昇順」は
    // **lastEventDate が等しい行同士**でのみ効く＝同日グループ、および開催日不明グループの
    // “中”での安定タイブレーク。design-spec §6 の並び順定義どおり。
    .orderBy(
      sql`${latest.eventDate} desc nulls last`,
      desc(participationCount),
      players.displayName,
    )
    .limit(50)

  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    affiliation: r.affiliation,
    prefecture: r.prefecture,
    participationCount: r.participationCount,
    currentGrade: r.currentGrade,
    lastEventDate: r.lastEventDate,
    lastTournamentName: r.lastTournamentName,
    // 最終出場の結果：①導出 bracket→ラベル ②生 final_rank ③null（＝記録なし）。
    // 導出は詳細画面 rank と単一ソース（derived_bracket は materialize 時に確定・
    // 保存値 == 詳細 rankBracket の不変条件を queries.test で担保済み）。
    lastResult:
      r.lastBracket != null
        ? labelForBracket(r.lastBracket)
        : r.lastFinalRank && r.lastFinalRank.trim() !== ''
          ? r.lastFinalRank
          : null,
  }))
}

/** 選手の表示名のみを引く軽量クエリ（戻る導線のラベル用）。存在しなければ null。 */
export async function getPlayerName(playerId: number): Promise<string | null> {
  const row = await db.query.players.findFirst({
    where: eq(players.id, playerId),
    columns: { displayName: true },
  })
  return row?.displayName ?? null
}

/**
 * 選手の全戦績。participants（生スナップショット）を起点に大会/級/順位/各試合を
 * 読み取り専用で集約する。
 * - 勝敗数は matches の status=normal のみから導出。
 * - 各大会の順位は対戦結果から導出（derivePlacement）。導出不能な級は保存 final_rank に
 *   フォールバック（requirements R1 / design-spec §6）。
 * - 各試合の相手は同一級で解決できていればその player_id を持たせ、戦績リンクに使う。
 */
export async function getPlayerRecord(
  playerId: number,
  opts?: GetPlayerRecordOptions,
): Promise<PlayerRecord | null> {
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

  // 絞り込みモード：`opts.filter` があるとき（?from=ranking 由来）だけ発火。フィルタ無し
  // 呼び出し（選手検索・相手名タップ）は現行パスのまま（挙動不変）。
  const filter = opts?.filter
  const bracketAtMost = opts?.bracketAtMost

  // ①期間＋級で対象 participant を軽量 join クエリで先に絞る（フィルタ時のみ）。ヘッダ集計は
  // この①母集合（bracket 条件なし）で、一覧は②bracketAtMost を追加適用した部分集合で描く。
  // derived_bracket と event_date も同じ行で取り、ヘッダの優勝/入賞/活動年計算に使う。
  let baseIdRows:
    | { id: number; bracket: number | null; eventDate: string | null }[]
    | null = null
  if (filter) {
    baseIdRows = await db
      .select({
        id: tournamentParticipants.id,
        bracket: tournamentParticipants.derivedBracket,
        eventDate: tournaments.eventDate,
      })
      .from(tournamentParticipants)
      .innerJoin(
        tournamentClasses,
        eq(tournamentClasses.id, tournamentParticipants.classId),
      )
      .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
      .where(and(eq(tournamentParticipants.playerId, playerId), ...filterConds(filter)))
  }
  const baseIds = baseIdRows?.map((r) => r.id) ?? null
  // 一覧に出す participant id。②指定時は①母集合を derived_bracket でさらに絞る
  // （null bracket＝導出不能は優勝/入賞と確定できないので除外＝ランキングと同じ割り切り）。
  const listIds =
    baseIdRows == null
      ? null
      : bracketAtMost != null
        ? baseIdRows
            .filter((r) => r.bracket != null && r.bracket <= bracketAtMost)
            .map((r) => r.id)
        : baseIds!

  // フィルタ時は①（＋②）で絞った participant id に限定。空の inArray は drizzle に渡さない
  // （コードベース既存パターン）＝①/②で 0 件なら一覧も空。
  const participantWhere =
    listIds != null
      ? and(
          eq(tournamentParticipants.playerId, playerId),
          inArray(tournamentParticipants.id, listIds),
        )
      : eq(tournamentParticipants.playerId, playerId)
  const participantRows =
    listIds != null && listIds.length === 0
      ? []
      : await db.query.tournamentParticipants.findMany({
          where: participantWhere,
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

  // 級全体の試合を一括取得し、級ごとに「決勝 round（=max round）」と「順位導出可否」を
  // 判定する。導出可否は**級単位**（リーグ/順位戦/3位決定戦/データ欠けは級ごと丸ごと
  // final_rank フォールバック）。本人の試合列だけでは非トーナメント形式を見抜けないため。
  const classIds = [...new Set(participantRows.map((p) => p.classId))]
  const classMatchRows = classIds.length
    ? await db
        .select({
          classId: matches.classId,
          round: matches.round,
          roundLabel: matches.roundLabel,
          result: matches.result,
          participantId: matches.participantId,
        })
        .from(matches)
        .where(inArray(matches.classId, classIds))
    : []
  const classInfo = new Map<number, { maxRound: number; derivable: boolean }>()
  {
    const byClass = new Map<number, typeof classMatchRows>()
    for (const r of classMatchRows) {
      const arr = byClass.get(r.classId)
      if (arr) arr.push(r)
      else byClass.set(r.classId, [r])
    }
    for (const [cid, rows] of byClass) {
      const maxRound = Math.max(...rows.map((r) => r.round))
      classInfo.set(cid, { maxRound, derivable: isDerivableClass(rows) })
    }
  }

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
        .select({
          id: tournamentParticipants.id,
          playerId: tournamentParticipants.playerId,
          affiliation: tournamentParticipants.affiliation,
        })
        .from(tournamentParticipants)
        .where(inArray(tournamentParticipants.id, opponentPartIds))
    : []
  const opponentInfoByPart = new Map(opponentRows.map((r) => [r.id, r]))

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
    const info = classInfo.get(p.classId)
    const derived = info?.derivable
      ? derivePlacement(placementMatches, info.maxRound)
      : null
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
        const info =
          m.opponentParticipantId != null
            ? opponentInfoByPart.get(m.opponentParticipantId)
            : undefined
        const oppPid = info?.playerId ?? null
        return {
          round: m.round,
          roundLabel: m.roundLabel,
          opponentName: m.opponentName,
          // 本人を指す解決は除外（R1 境界）。
          opponentPlayerId: oppPid != null && oppPid !== playerId ? oppPid : null,
          opponentAffiliation: info?.affiliation ?? null,
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

  // ヘッダ集計（優勝 N・入賞 N・出場大会数・活動年スパン）。
  // - 絞り込み時：①母集合を derived_bracket で数える（優勝/入賞回数ランキングと単一定義）。
  //   一覧が②で更に絞られてもヘッダ集計の母集合は①のまま（優勝大会だけで数えない）。
  // - 非絞り込み時：現行どおり participations（＝全成績・上の map で導出済み）から算出。
  if (baseIdRows != null) {
    championships = baseIdRows.filter((r) => r.bracket === 1).length
    nyushoCount = baseIdRows.filter((r) => r.bracket != null && r.bracket <= 8).length
  }
  const tournamentCount = baseIdRows != null ? baseIdRows.length : participations.length
  // 活動年スパンも①母集合の event_date から（絞り込み時は participations が②で欠けうるため）。
  const yearSource =
    baseIdRows != null
      ? baseIdRows.map((r) => r.eventDate)
      : participations.map((p) => p.eventDate)
  const years = yearSource
    .filter((d): d is string => !!d)
    .map((d) => Number(d.slice(0, 4)))
    .filter((y) => !Number.isNaN(y))
  const activeYears =
    years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null

  // アイデンティティ（現級・ヘッダ所属）は「その人が誰か」の情報。絞り込み条件で変えない。
  // 絞り込み時のみ全成績ベースの軽量クエリで別取得（searchPlayers の相関サブクエリと同型：
  // event_date 降順 NULLS LAST・同日 id 降順の直近1件）。非絞り込み時は participations から導出。
  let currentGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  let currentAffiliation: string | null
  if (filter) {
    const [gradeRow] = await db
      .select({ grade: tournamentClasses.grade })
      .from(tournamentParticipants)
      .innerJoin(
        tournamentClasses,
        eq(tournamentClasses.id, tournamentParticipants.classId),
      )
      .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
      .where(
        and(
          eq(tournamentParticipants.playerId, playerId),
          isNotNull(tournamentClasses.grade),
        ),
      )
      .orderBy(sql`${tournaments.eventDate} desc nulls last`, desc(tournaments.id))
      .limit(1)
    const [affRow] = await db
      .select({ affiliation: tournamentParticipants.affiliation })
      .from(tournamentParticipants)
      .innerJoin(
        tournamentClasses,
        eq(tournamentClasses.id, tournamentParticipants.classId),
      )
      .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
      .where(eq(tournamentParticipants.playerId, playerId))
      .orderBy(sql`${tournaments.eventDate} desc nulls last`, desc(tournaments.id))
      .limit(1)
    currentGrade = gradeRow?.grade ?? null
    currentAffiliation = affRow?.affiliation ?? null
  } else {
    currentGrade = participations.find((p) => p.grade != null)?.grade ?? null
    currentAffiliation = participations[0]?.affiliation ?? null
  }

  // 勝敗数は status=normal のみ。DB 側で集計して導出する。絞り込み時は①母集合の participant
  // に限定（inArray）。①で 0 件なら追加クエリせず 0勝0敗。
  let totalWins = 0
  let totalLosses = 0
  if (!(baseIds != null && baseIds.length === 0)) {
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
      .where(
        baseIds != null
          ? and(
              eq(tournamentParticipants.playerId, playerId),
              inArray(tournamentParticipants.id, baseIds),
            )
          : eq(tournamentParticipants.playerId, playerId),
      )
    totalWins = agg?.wins ?? 0
    totalLosses = agg?.losses ?? 0
  }

  return {
    player,
    participations,
    totalWins,
    totalLosses,
    championships,
    nyushoCount,
    tournamentCount,
    activeYears,
    currentGrade,
    currentAffiliation,
  }
}
