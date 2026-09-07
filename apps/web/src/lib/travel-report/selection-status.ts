import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { TravelSelectionStatus } from '@kagetra/shared'
import {
  entryGroupSelectionStatuses,
  eventAttendances,
  events,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  users,
} from '@kagetra/shared/schema'
import { db } from '@/lib/db'

/**
 * travel-report タスク3: 「確定状況」（requirements R3・AC-8/AC-9）。
 *
 * ★★**この値を dashboard・upcoming-entrants（`@/lib/upcoming-entrants`）・
 * 外部 API（`/api/external/tournament-entrants`）から import してはいけない。**
 * 確定状況は今回**遠征届の対象者判定にだけ**使う（requirements §5 Non-goals）。
 * ホームの出場タイムライン・外部提供 API・参加費集計・振込連絡には配線しない。
 *
 * `entry_group_selection_statuses` は**手入力だけ**を保持する。画面の初期表示・
 * 遠征届の対象者判定に使う「有効な確定状況」は {@link deriveEffectiveSelection} の
 * 導出順（手入力 → 取込済み確定名簿 → 確定）に従う。導出結果をこのテーブルへ
 * 書き込んではならない——書くと次の名簿再取込（繰上げ反映）が手入力に隠れて
 * 効かなくなる。「取込名簿の結果に戻す」は手入力行の DELETE で実装する
 * （`resetSelectionStatuses`。`travel-report-actions.ts`）。
 */

/** `tournament_entry_roster_entries` の関連2列（導出の入力）。 */
export interface RosterOutcomeInput {
  status: 'applied' | 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled'
  selectionOutcome: 'accepted' | 'waitlisted' | 'rejected' | 'unknown'
}

/**
 * 有効な確定状況の導出（純関数。requirements R3・技術計画の導出順）。
 *
 * 1. 手入力（`entry_group_selection_statuses` の行）があればそれを返す
 * 2. 無ければ取込確定名簿の行（`superseded_at IS NULL` の `roster_type='confirmed'`
 *    版）を `status` と `selection_outcome` の両方で写像する
 * 3. 名簿行も無ければ（ゲスト・未同定）「確定」
 *
 * ★分岐の順序を変えない。`selectionOutcome==='waitlisted'` を最初に見るため、
 * 2番目の分岐（不参加）に達した時点で `waitlisted` は除外済みという前提で
 * 判定が書かれている。
 */
export function deriveEffectiveSelection(
  manual: TravelSelectionStatus | null,
  rosterRow: RosterOutcomeInput | null,
): TravelSelectionStatus {
  if (manual != null) return manual
  if (rosterRow == null) return 'confirmed'

  const { status, selectionOutcome } = rosterRow
  if (selectionOutcome === 'waitlisted') return 'waitlisted'
  if (selectionOutcome === 'rejected' || status === 'cancelled' || status === 'carry_up_declined') {
    return 'not_participating'
  }
  // ここへ来た時点で selectionOutcome は waitlisted / rejected ではない（上の2分岐で
   // return 済み）。仕様の条件式にある `outcome ∉ {waitlisted, rejected}` は制御フローで
   // 保証されているので、重ねて書くと tsc が always-true と判定する。
  if (status === 'confirmed' || status === 'carried_up') return 'confirmed'
  return 'confirmed'
}

/**
 * 1グループぶんの「有効な確定状況」を `Map<userId, TravelSelectionStatus>` で返す。
 * 遠征届の対象者判定（別タスク）はこの読み出し関数を使う。
 *
 * ★**疎な Map**——手入力行、または取込確定名簿にその人の行があるユーザーだけを
 * キーに持つ。名簿にも手入力にも現れないユーザー（名簿未取込・ゲスト未同定等）は
 * キーごと存在しない。**呼び出し側は「Map に無ければ確定」として扱うこと**
 * （導出の第3分岐と同じ既定値）。あらかじめ出欠参加者全員を 'confirmed' で
 * 埋めてしまうと、「データが無い」と「明示的に確定にした」を呼び出し側が
 * 区別できなくなる。
 *
 * 対象の確定名簿は、そのグループの `roster_type='confirmed'` かつ
 * `superseded_at IS NULL` の版。ユニーク制約は (entry_group_id, roster_type, version)
 * であって `superseded_at IS NULL` の一意性までは保証しないため、**先に有効な
 * confirmed 名簿を version 降順で1件だけ選び、その roster ID の行だけ**を引く
 * （複数版が同時に「有効」のまま残る事故があっても、最新版とだけ突き合わせる）。
 */
export async function getEffectiveSelectionStatuses(
  entryGroupId: number,
): Promise<Map<string, TravelSelectionStatus>> {
  const [manualRows, activeRoster] = await Promise.all([
    db
      .select({ userId: entryGroupSelectionStatuses.userId, status: entryGroupSelectionStatuses.status })
      .from(entryGroupSelectionStatuses)
      .where(eq(entryGroupSelectionStatuses.entryGroupId, entryGroupId)),
    db
      .select({ id: tournamentEntryRosters.id })
      .from(tournamentEntryRosters)
      .where(
        and(
          eq(tournamentEntryRosters.entryGroupId, entryGroupId),
          eq(tournamentEntryRosters.rosterType, 'confirmed'),
          isNull(tournamentEntryRosters.supersededAt),
        ),
      )
      .orderBy(desc(tournamentEntryRosters.version))
      .limit(1),
  ])

  const rosterRows = activeRoster[0]
    ? await db
        .select({
          id: tournamentEntryRosterEntries.id,
          userId: tournamentEntryRosterEntries.userId,
          status: tournamentEntryRosterEntries.status,
          selectionOutcome: tournamentEntryRosterEntries.selectionOutcome,
        })
        .from(tournamentEntryRosterEntries)
        .where(eq(tournamentEntryRosterEntries.rosterId, activeRoster[0].id))
        .orderBy(asc(tournamentEntryRosterEntries.id))
    : []

  const rosterByUserId = new Map<string, RosterOutcomeInput>()
  for (const row of rosterRows) {
    if (row.userId == null) continue
    if (rosterByUserId.has(row.userId)) continue
    rosterByUserId.set(row.userId, { status: row.status, selectionOutcome: row.selectionOutcome })
  }

  const manualByUserId = new Map<string, TravelSelectionStatus>(
    manualRows.map((r) => [r.userId, r.status]),
  )

  const userIds = new Set<string>([...manualByUserId.keys(), ...rosterByUserId.keys()])
  const result = new Map<string, TravelSelectionStatus>()
  for (const userId of userIds) {
    result.set(
      userId,
      deriveEffectiveSelection(manualByUserId.get(userId) ?? null, rosterByUserId.get(userId) ?? null),
    )
  }
  return result
}

/** S5「確定状況」の1行ぶんの表示 DTO。 */
export interface SelectionStatusRow {
  userId: string
  name: string | null
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  isGuest: boolean
  status: TravelSelectionStatus
}

/**
 * S5 名簿セクションの「確定状況」開閉行に渡す表示用の行を組み立てる。
 *
 * 対象＝当該グループの**いずれかの日**に出欠「参加」と答えた会員・ゲスト
 * （requirements R3）。退会済み（`deactivated_at` あり）は除く。
 *
 * ★cancelled の日を除外しない——この画面の「参加希望 のべN名」（page.tsx の
 * `attendanceRows`）と同じ母集団にする（グループ内の判定を割らないため）。
 * 遠征単位ごとの対象者判定（別タスク）は単位内の日で絞るため、この関数の
 * 出力をそのまま対象者判定に使わない。
 */
export async function loadSelectionStatusRows(entryGroupId: number): Promise<SelectionStatusRow[]> {
  const eventRows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.entryGroupId, entryGroupId))
  const eventIds = eventRows.map((e) => e.id)
  if (eventIds.length === 0) return []

  const attendeeRows = await db
    .selectDistinctOn([users.id], {
      userId: users.id,
      name: users.name,
      grade: users.grade,
      role: users.role,
    })
    .from(eventAttendances)
    .innerJoin(users, eq(users.id, eventAttendances.userId))
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.attend, true),
        isNull(users.deactivatedAt),
      ),
    )
    .orderBy(asc(users.id))

  if (attendeeRows.length === 0) return []

  const effectiveByUserId = await getEffectiveSelectionStatuses(entryGroupId)

  return attendeeRows.map((row) => ({
    userId: row.userId,
    name: row.name,
    grade: row.grade,
    isGuest: row.role === 'guest',
    status: effectiveByUserId.get(row.userId) ?? 'confirmed',
  }))
}
