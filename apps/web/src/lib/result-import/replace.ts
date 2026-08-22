import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  resultDrafts,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
} from '@kagetra/shared/schema'
import type { LotteryGrade } from '@/lib/roster-import/adoption'

// Works for both NodePgDatabase (main db) and NodePgTransaction (inside tx callback).
type DbLike = NodePgDatabase<typeof schema>

/**
 * tournament-results 2026-08 改修: 既取込級の「差し替え」ヘルパー。
 *
 * materialize 済みの4表（tournaments / tournament_classes /
 * tournament_participants / matches）は `result_drafts.extracted_payload` と
 * メール添付から常に再導出できる**導出層**なので、訂正版の差し替えは論理削除
 * （supersede 列）ではなく**物理削除**で行う。論理削除は統計・戦績・当落線の
 * 読み取り約35箇所へ除外フィルタを恒久的に課し、1箇所の漏れが当落線の静かな
 * 二重計上になるため（要件 §7 の設計判断）。
 *
 * 呼び出し順は approveResultDraft が守る:
 *   ① collectReplacementTargets（**materialize より前**。新旧が混ざる前に旧側を確定させる）
 *   ② materialize（選択級のみ）
 *   ③ linkActualResultClass(replaceExisting: true) で active fact を新級へ
 *   ④ deleteReplacedClasses（旧級 DELETE・空 tournaments DELETE・監査記録）
 *   ⑤ 旧側 player の display_name / 会員リンク再計算
 */

export interface ReplacementSnapshot {
  /** 差し替えで削除される旧 tournament_classes の id 群。 */
  classIds: number[]
  /** 旧クラス配下にいた選手 id 群（削除後の display_name 再計算対象）。 */
  playerIds: number[]
  /** 旧クラスが属していた tournaments の id 群（重複なし）。 */
  tournamentIds: number[]
}

export interface ReplacementAudit {
  /** クラスが全滅して削除された旧 tournaments の id。 */
  deletedTournamentIds: number[]
  /** `superseded` へ遷移させた旧ドラフトの id。 */
  supersededDraftIds: number[]
  /** 一部の級だけ差し替えられ、note に記録を追記した旧 tournaments の id。 */
  notedTournamentIds: number[]
}

/**
 * 差し替え対象 grade の旧クラスと、その配下の選手・所属大会を収集する。
 * **materialize より前**に呼ぶこと（後から呼ぶと今まさに作った新クラスまで
 * 拾ってしまい、作った直後に消すことになる）。
 */
export async function collectReplacementTargets(
  tx: DbLike,
  editionId: number,
  grades: LotteryGrade[],
): Promise<ReplacementSnapshot> {
  const empty: ReplacementSnapshot = { classIds: [], playerIds: [], tournamentIds: [] }
  if (grades.length === 0) return empty

  const classRows = await tx
    .select({
      classId: tournamentClasses.id,
      tournamentId: tournamentClasses.tournamentId,
    })
    .from(tournamentClasses)
    .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
    .where(and(eq(tournaments.editionId, editionId), inArray(tournamentClasses.grade, grades)))

  if (classRows.length === 0) return empty

  const classIds = classRows.map((row) => row.classId)
  const tournamentIds = [...new Set(classRows.map((row) => row.tournamentId))]

  const playerRows = await tx
    .selectDistinct({ playerId: tournamentParticipants.playerId })
    .from(tournamentParticipants)
    .where(
      and(
        inArray(tournamentParticipants.classId, classIds),
        isNotNull(tournamentParticipants.playerId),
      ),
    )

  return {
    classIds,
    playerIds: playerRows.flatMap((row) => (row.playerId === null ? [] : [row.playerId])),
    tournamentIds,
  }
}

/**
 * 旧クラス群を物理削除し（participants / matches は FK cascade）、クラスが
 * 0 件になった旧 `tournaments` 行も削除する。監査は次の2形で残す:
 *
 *   - 大会ごと消えた（全級差し替え）→ その大会を生んだ承認済みドラフトを
 *     `status='superseded'` + `superseded_by_draft_id` にする
 *   - 一部の級だけ消えた（部分差し替え）→ 旧 `tournaments.note` へ追記する
 *     （旧ドラフトは approved のまま。残りの級の原本であり続けるため）
 *
 * 旧ドラフトの `tournament_id` は tournaments 削除時に FK（ON DELETE SET NULL）
 * で null になるため、**削除前に対象ドラフト id を控えてから**更新する。
 */
export async function deleteReplacedClasses(
  tx: DbLike,
  input: {
    snapshot: ReplacementSnapshot
    /** 差し替えを行った新しいドラフト（superseded_by_draft_id に入る）。 */
    newDraftId: number
    /** 差し替えた grade 群（note の文面に使う）。 */
    replacedGrades: LotteryGrade[]
    /** note に載せる日付（JST の YYYY-MM-DD）。 */
    today: string
  },
): Promise<ReplacementAudit> {
  const { snapshot, newDraftId, replacedGrades, today } = input
  const audit: ReplacementAudit = {
    deletedTournamentIds: [],
    supersededDraftIds: [],
    notedTournamentIds: [],
  }
  if (snapshot.classIds.length === 0) return audit

  // 旧 tournaments を生んだドラフトを、削除で tournament_id が消える前に控える。
  const draftRows = await tx
    .select({ id: resultDrafts.id, tournamentId: resultDrafts.tournamentId, status: resultDrafts.status })
    .from(resultDrafts)
    .where(inArray(resultDrafts.tournamentId, snapshot.tournamentIds))
  const draftIdsByTournament = new Map<number, number[]>()
  for (const row of draftRows) {
    if (row.tournamentId === null) continue
    // 差し替えを行う当のドラフト自身は対象外（自分で自分を superseded にしない）。
    if (row.id === newDraftId) continue
    if (row.status !== 'approved') continue
    const ids = draftIdsByTournament.get(row.tournamentId)
    if (ids) ids.push(row.id)
    else draftIdsByTournament.set(row.tournamentId, [row.id])
  }

  // 旧級を物理削除（tournament_participants / matches は FK cascade）。
  await tx.delete(tournamentClasses).where(inArray(tournamentClasses.id, snapshot.classIds))

  // 級が残っているかで「大会ごと消す」「note 追記」を振り分ける。
  const remaining = await tx
    .select({ tournamentId: tournamentClasses.tournamentId })
    .from(tournamentClasses)
    .where(inArray(tournamentClasses.tournamentId, snapshot.tournamentIds))
  const survivors = new Set(remaining.map((row) => row.tournamentId))

  const emptied = snapshot.tournamentIds.filter((id) => !survivors.has(id))
  const noteLine = `【差し替え】${today}: ${replacedGrades.join('・')}級を結果ドラフト #${newDraftId} で差し替え`

  for (const tournamentId of snapshot.tournamentIds) {
    if (survivors.has(tournamentId)) {
      await tx
        .update(tournaments)
        .set({
          // note が NULL のときは改行を挟まずに1行目として書く。
          note: sql`coalesce(${tournaments.note} || E'\n', '') || ${noteLine}`,
          updatedAt: sql`now()`,
        })
        .where(eq(tournaments.id, tournamentId))
      audit.notedTournamentIds.push(tournamentId)
    }
  }

  if (emptied.length > 0) {
    await tx.delete(tournaments).where(inArray(tournaments.id, emptied))
    audit.deletedTournamentIds = emptied

    const supersededIds = emptied.flatMap((id) => draftIdsByTournament.get(id) ?? [])
    if (supersededIds.length > 0) {
      const updated = await tx
        .update(resultDrafts)
        .set({
          status: 'superseded',
          supersededByDraftId: newDraftId,
          updatedAt: sql`now()`,
        })
        .where(and(inArray(resultDrafts.id, supersededIds), eq(resultDrafts.status, 'approved')))
        .returning({ id: resultDrafts.id })
      audit.supersededDraftIds = updated.map((row) => row.id)
    }
  }

  return audit
}
