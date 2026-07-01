import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { matches, tournamentClasses, tournamentParticipants, tournaments } from '@kagetra/shared/schema'
import type { Grade } from './types'
import { ALL_GRADES } from './types'

/**
 * ② 大会詳細（`/tournaments/[id]`）のサーバー集計。requirements §3.4 / §4.2、design-spec §3.5。
 * 読み取り専用。1 大会（tournament）の各**級ブロック**（tournament_classes 1 行 = 1 ブロック）を
 * 「入賞者」と「クロス表（選手×回戦）」の 2 ビュー分に整形して返す。
 *
 * - 入賞者＝事前計算列 `derived_bracket` を集約（優勝=1／2位=2／3位=ベスト4／4位=ベスト8）。
 *   導出不能級（全 bracket null）は保存 `final_rank` からベストエフォートで拾う（design-spec §5）。
 *   順位定義は戦績詳細（getPlayerRecord）と単一ソース（§4.1）。
 * - クロス表＝選手×回戦のグリッド。各セル＝その選手のその回戦の対戦（○/×・相手・枚数差）。
 *   行は**勝ち上がり順**（到達回戦降順→最終試合の勝敗）で並べ、敗退後の回戦は欠落＝勝ち残りが
 *   逆三角形に見える（design-spec §3.5）。相手不明の対戦は捏造しない＝存在する match 行だけを置く。
 * - 同一級が複数ブロックに分割運営される場合はタブを **A1／A2** に分ける（tournament_classes 単位）。
 */

/** 入賞者の 1 人。行タップ → `/players/[id]`（playerId が null なら非リンク）。 */
export interface WinnerEntry {
  participantId: number
  playerId: number | null
  name: string
  /** その大会での所属（participant 生スナップショット）。 */
  affiliation: string | null
}

/** 入賞順位（優勝／2位／3位／4位）。3位・4位は同着で複数になり得る。 */
export interface WinnerPlace {
  /** 1=優勝 / 2=2位 / 3=3位 / 4=4位。 */
  place: 1 | 2 | 3 | 4
  label: string
  entries: WinnerEntry[]
  /** derived_bracket 由来でなく final_rank から拾った場合 true（UI で扱いを変える余地）。 */
  fromFinalRank: boolean
}

/** クロス表の 1 セル（ある選手のある回戦の対戦）。 */
export interface CrosstabCell {
  round: number
  result: 'win' | 'lose'
  /** 相手名（生テキスト・不戦/棄権は null もあり得る）。 */
  opponentName: string | null
  /** 枚数差（不戦勝・棄権は null）。 */
  scoreDiff: number | null
  status: 'normal' | 'walkover' | 'forfeit'
}

/** クロス表の行（1 選手）。行タップ → 戦績詳細。 */
export interface CrosstabRow {
  participantId: number
  playerId: number | null
  name: string
  affiliation: string | null
  /** 回戦番号 → セル（存在する対戦のみ。敗退後の回戦は欠落）。 */
  cells: Record<number, CrosstabCell>
  /** 到達回戦（match が付いた最大 round・無ければ 0）。並び替えの主キー。 */
  reachedRound: number
}

/** クロス表の列（回戦）。 */
export interface CrosstabColumn {
  round: number
  label: string
}

/** 級ブロック（tournament_classes 1 行）。タブ 1 つ分。 */
export interface ClassBlock {
  classId: number
  /** タブ表示名（級あり＝A／A1／A2、級なし＝className）。 */
  label: string
  grade: Grade | null
  className: string
  numPlayers: number | null
  /** 入賞者（順位昇順）。空配列＝入賞者を導出できない。 */
  winners: WinnerPlace[]
  /** クロス表（列＝回戦昇順・行＝勝ち上がり順）。 */
  crosstab: { columns: CrosstabColumn[]; rows: CrosstabRow[] }
}

export interface TournamentResults {
  tournamentId: number
  name: string
  eventDate: string | null
  venue: string | null
  blocks: ClassBlock[]
}

/** derived_bracket → 入賞順位（優勝/2位/3位/4位）。それ以外（ベスト16 等）は入賞に含めない。 */
function bracketToPlace(bracket: number | null): 1 | 2 | 3 | 4 | null {
  switch (bracket) {
    case 1:
      return 1
    case 2:
      return 2
    case 4:
      return 3
    case 8:
      return 4
    default:
      return null
  }
}

/**
 * 自由記述 `final_rank` から入賞順位をベストエフォートで拾う（導出不能級のフォールバック）。
 * NFKC で全角数字/空白を畳んでから代表的表記だけを拾い、曖昧なら null（＝非表示）。
 */
function finalRankToPlace(finalRank: string | null): 1 | 2 | 3 | 4 | null {
  if (!finalRank) return null
  const s = finalRank.normalize('NFKC').replace(/\s/g, '')
  if (/準優勝|準優/.test(s)) return 2
  if (/優勝/.test(s)) return 1
  if (/(^|[^0-9])2位/.test(s)) return 2
  if (/(^|[^0-9])3位|ベスト4|準決勝/.test(s)) return 3
  if (/(^|[^0-9])4位|ベスト8|準々決勝/.test(s)) return 4
  return null
}

const PLACE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: '優勝',
  2: '2位',
  3: '3位',
  4: '4位',
}

/** 級ブロックのタブ表示名を決める（同一級の複数ブロックは A1／A2…）。 */
function blockLabels(
  classes: { classId: number; grade: Grade | null; className: string }[],
): Map<number, string> {
  // 級ごとの出現順（class 配列の順＝id 昇順）でナンバリングする。
  const byGrade = new Map<Grade, number[]>()
  for (const c of classes) {
    if (c.grade == null) continue
    const arr = byGrade.get(c.grade)
    if (arr) arr.push(c.classId)
    else byGrade.set(c.grade, [c.classId])
  }
  const labels = new Map<number, string>()
  for (const c of classes) {
    if (c.grade == null) {
      // 級なし（名人級/クイーン級/団体等）は className をそのままタブ名に。
      labels.set(c.classId, c.className)
      continue
    }
    const ids = byGrade.get(c.grade)!
    if (ids.length === 1) {
      labels.set(c.classId, c.grade)
    } else {
      const idx = ids.indexOf(c.classId)
      labels.set(c.classId, `${c.grade}${idx + 1}`)
    }
  }
  return labels
}

interface MatchRow {
  classId: number
  round: number
  roundLabel: string | null
  participantId: number
  opponentName: string | null
  scoreDiff: number | null
  result: 'win' | 'lose'
  status: 'normal' | 'walkover' | 'forfeit'
}

/** 級内 matches からクロス表（列＝回戦・行＝勝ち上がり順）を組む。 */
function buildCrosstab(
  participants: {
    id: number
    playerId: number | null
    name: string
    affiliation: string | null
    derivedBracket: number | null
  }[],
  classMatches: MatchRow[],
): { columns: CrosstabColumn[]; rows: CrosstabRow[] } {
  // 列（回戦）：出現した round を昇順に。列ラベルは round ごとの代表 roundLabel（最頻の
  // 非 null）か `${round}回戦`。決勝/準決勝など意味ラベルがあればそれを見出しに使える。
  const roundLabelVotes = new Map<number, Map<string, number>>()
  const roundSet = new Set<number>()
  for (const m of classMatches) {
    roundSet.add(m.round)
    if (m.roundLabel) {
      let votes = roundLabelVotes.get(m.round)
      if (!votes) {
        votes = new Map()
        roundLabelVotes.set(m.round, votes)
      }
      votes.set(m.roundLabel, (votes.get(m.roundLabel) ?? 0) + 1)
    }
  }
  const columns: CrosstabColumn[] = [...roundSet]
    .sort((a, b) => a - b)
    .map((round) => {
      const votes = roundLabelVotes.get(round)
      let label = `${round}回戦`
      if (votes) {
        let best = 0
        for (const [lbl, n] of votes) {
          if (n > best) {
            best = n
            label = lbl
          }
        }
      }
      return { round, label }
    })

  // 行（選手）：各 participant のセルを round キーで置く。到達回戦（max round）を記録。
  const cellsByPart = new Map<number, Record<number, CrosstabCell>>()
  const reachedByPart = new Map<number, number>()
  const lastResultByPart = new Map<number, { round: number; result: 'win' | 'lose' }>()
  for (const m of classMatches) {
    let cells = cellsByPart.get(m.participantId)
    if (!cells) {
      cells = {}
      cellsByPart.set(m.participantId, cells)
    }
    // 同一 (選手, round) の重複は先勝ち（ブラケットなら 1 回戦 1 試合・稀な重複は無視）。
    if (cells[m.round] == null) {
      cells[m.round] = {
        round: m.round,
        result: m.result,
        opponentName: m.opponentName,
        scoreDiff: m.scoreDiff,
        status: m.status,
      }
    }
    const reached = reachedByPart.get(m.participantId) ?? 0
    if (m.round >= reached) {
      reachedByPart.set(m.participantId, m.round)
      const last = lastResultByPart.get(m.participantId)
      // 同 round に複数（リーグ等）でも「到達回戦の勝敗」は最後に見た行で確定させる。
      if (!last || m.round >= last.round) {
        lastResultByPart.set(m.participantId, { round: m.round, result: m.result })
      }
    }
  }

  const rows: CrosstabRow[] = participants.map((p) => ({
    participantId: p.id,
    playerId: p.playerId,
    name: p.name,
    affiliation: p.affiliation,
    cells: cellsByPart.get(p.id) ?? {},
    reachedRound: reachedByPart.get(p.id) ?? 0,
  }))

  // 勝ち上がり順：到達回戦降順 → 到達回戦で勝ち(=更に上へ進んだ)を先 → bracket 昇順 → 名前。
  // これで優勝者（決勝勝ち）が先頭、以下敗退が早いほど下に来て逆三角形になる。
  const bracketByPart = new Map(participants.map((p) => [p.id, p.derivedBracket]))
  rows.sort((a, b) => {
    if (a.reachedRound !== b.reachedRound) return b.reachedRound - a.reachedRound
    const aWon = lastResultByPart.get(a.participantId)?.result === 'win'
    const bWon = lastResultByPart.get(b.participantId)?.result === 'win'
    if (aWon !== bWon) return aWon ? -1 : 1
    const ab = bracketByPart.get(a.participantId)
    const bb = bracketByPart.get(b.participantId)
    if (ab != null && bb != null && ab !== bb) return ab - bb
    if ((ab == null) !== (bb == null)) return ab == null ? 1 : -1
    return a.name.localeCompare(b.name, 'ja')
  })

  return { columns, rows }
}

/** 級ブロックの入賞者（順位昇順）を組む。derived_bracket 優先・非導出級は final_rank。 */
function buildWinners(
  participants: {
    id: number
    playerId: number | null
    name: string
    affiliation: string | null
    finalRank: string | null
    derivedBracket: number | null
  }[],
): WinnerPlace[] {
  const derivable = participants.some((p) => p.derivedBracket != null)
  const byPlace = new Map<1 | 2 | 3 | 4, WinnerEntry[]>()
  const fromFinalRank = !derivable
  for (const p of participants) {
    const place = derivable ? bracketToPlace(p.derivedBracket) : finalRankToPlace(p.finalRank)
    if (place == null) continue
    const entry: WinnerEntry = {
      participantId: p.id,
      playerId: p.playerId,
      name: p.name,
      affiliation: p.affiliation,
    }
    const arr = byPlace.get(place)
    if (arr) arr.push(entry)
    else byPlace.set(place, [entry])
  }
  const places: WinnerPlace[] = []
  for (const place of [1, 2, 3, 4] as const) {
    const entries = byPlace.get(place)
    if (entries && entries.length > 0) {
      // 同着は名前順で安定化。
      entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      places.push({ place, label: PLACE_LABEL[place], entries, fromFinalRank })
    }
  }
  return places
}

/**
 * getTournamentResults — 1 大会の入賞者＋級クロス表。存在しなければ null。
 * classes / participants / matches を 3 クエリで取り、級ごとに JS で整形する
 * （getPlayerRecord と同じ read パターン）。
 */
export async function getTournamentResults(
  tournamentId: number,
): Promise<TournamentResults | null> {
  // 正の 32bit 整数（PG int4）のみ。範囲外は id 列比較が overflow で 500 になるので早期 null。
  if (!Number.isInteger(tournamentId) || tournamentId <= 0 || tournamentId > 2147483647) {
    return null
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
    columns: { id: true, name: true, eventDate: true, venue: true },
  })
  if (!tournament) return null

  const classRows = await db
    .select({
      classId: tournamentClasses.id,
      className: tournamentClasses.className,
      grade: tournamentClasses.grade,
      numPlayers: tournamentClasses.numPlayers,
    })
    .from(tournamentClasses)
    .where(eq(tournamentClasses.tournamentId, tournamentId))
    .orderBy(asc(tournamentClasses.id))
  if (classRows.length === 0) {
    return {
      tournamentId: tournament.id,
      name: tournament.name,
      eventDate: tournament.eventDate,
      venue: tournament.venue,
      blocks: [],
    }
  }

  const classIds = classRows.map((c) => c.classId)
  const partRows = await db
    .select({
      id: tournamentParticipants.id,
      classId: tournamentParticipants.classId,
      playerId: tournamentParticipants.playerId,
      name: tournamentParticipants.name,
      affiliation: tournamentParticipants.affiliation,
      finalRank: tournamentParticipants.finalRank,
      derivedBracket: tournamentParticipants.derivedBracket,
    })
    .from(tournamentParticipants)
    .where(inArray(tournamentParticipants.classId, classIds))
    .orderBy(asc(tournamentParticipants.seqNo), asc(tournamentParticipants.id))
  const matchRows: MatchRow[] = await db
    .select({
      classId: matches.classId,
      round: matches.round,
      roundLabel: matches.roundLabel,
      participantId: matches.participantId,
      opponentName: matches.opponentName,
      scoreDiff: matches.scoreDiff,
      result: matches.result,
      status: matches.status,
    })
    .from(matches)
    .where(inArray(matches.classId, classIds))

  const partsByClass = new Map<number, typeof partRows>()
  for (const p of partRows) {
    const arr = partsByClass.get(p.classId)
    if (arr) arr.push(p)
    else partsByClass.set(p.classId, [p])
  }
  const matchesByClass = new Map<number, MatchRow[]>()
  for (const m of matchRows) {
    const arr = matchesByClass.get(m.classId)
    if (arr) arr.push(m)
    else matchesByClass.set(m.classId, [m])
  }

  const labels = blockLabels(classRows)
  const blocks: ClassBlock[] = classRows.map((c) => {
    const parts = partsByClass.get(c.classId) ?? []
    const ms = matchesByClass.get(c.classId) ?? []
    return {
      classId: c.classId,
      label: labels.get(c.classId) ?? c.className,
      grade: c.grade,
      className: c.className,
      numPlayers: c.numPlayers,
      winners: buildWinners(parts),
      crosstab: buildCrosstab(parts, ms),
    }
  })

  return {
    tournamentId: tournament.id,
    name: tournament.name,
    eventDate: tournament.eventDate,
    venue: tournament.venue,
    blocks,
  }
}

/** 級ブロックの表示順ソート用（A→E→級なし、同級は label で安定化）。UI 側で使う。 */
export function sortBlocks(blocks: ClassBlock[]): ClassBlock[] {
  const gradeOrder = (g: Grade | null) => (g == null ? ALL_GRADES.length : ALL_GRADES.indexOf(g))
  return [...blocks].sort((a, b) => {
    const ga = gradeOrder(a.grade)
    const gb = gradeOrder(b.grade)
    if (ga !== gb) return ga - gb
    return a.label.localeCompare(b.label, 'ja')
  })
}
