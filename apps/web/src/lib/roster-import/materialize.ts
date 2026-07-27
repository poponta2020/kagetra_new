import { and, desc, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  players,
  entryGroups,
  tournamentConfirmedRosterPublications,
  tournamentEntryRosters,
  tournamentEntryRosterEntries,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'
import type { ParsedRoster } from './parser'
import {
  loadUniqueMemberNameMap,
  resolveUniqueMemberId,
  syncPlayersToUniqueMembers,
} from '@/lib/players/member-link'

type DbLike = NodePgDatabase<typeof schema>
type RosterGrade = 'A' | 'B' | 'C' | 'D' | 'E'

export type RosterType = 'applicant' | 'confirmed'
export type RosterEntryStatus =
  | 'applied'
  | 'confirmed'
  | 'carried_up'
  | 'carry_up_declined'
  | 'cancelled'

export interface MaterializeRosterOpts {
  entryGroupId: number
  rosterType: RosterType
  publishedAt?: string | null
  sourceAttachmentId?: number | null
  sourceMailMessageId?: number | null
  note?: string | null
  approvedByUserId?: string | null
  revision:
    | { kind: 'initial' }
    | { kind: 'correction'; targetRosterId: number }
    | { kind: 'additional' }
}

export interface MaterializeRosterResult {
  rosterId: number
  version: number
  supersededRosterId: number | null
  entryCount: number
  /** entry.user_id が解決できた行数（自会員の突合数）。 */
  matchedUserCount: number
}

/**
 * 名簿ファイルの解析結果を tournament_entry_rosters / _entries へ materialize する（caller の tx 内）。
 *
 * - **再取込は版管理**: correction は明示した有効版だけを superseded にして新版を追加する。
 *   additional は後日の確定者追加など、旧発表を残したまま新版を併存させる。
 * - 各行を players に解決（姓名のみ同定・onConflictDoNothing、result-import と同型）。所属は player に
 *   持たせず raw_* に保持（[[impl_player_identity_name_only]]）。
 * - 会員突合: 正規化姓名が会員(users.name)に**単独一致**したとき entry.user_id を張る（曖昧は null）。
 */
export async function materializeRoster(
  tx: DbLike,
  parsed: ParsedRoster,
  opts: MaterializeRosterOpts,
): Promise<MaterializeRosterResult> {
  // 1. entry_group 行をロックし、同じグループ/type の並行取込でも版番号を重複させない
  //    （entry-groups タスク8: 名簿の帰属は event → entry_group）。
  const lockedGroup = await tx
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, opts.entryGroupId))
    .for('update')
  if (lockedGroup.length === 0) throw new Error('名簿の対象申込グループが見つかりません')

  const existingRosters = await tx
    .select({
      id: tournamentEntryRosters.id,
      version: tournamentEntryRosters.version,
      supersededAt: tournamentEntryRosters.supersededAt,
    })
    .from(tournamentEntryRosters)
    .where(
      and(
        eq(tournamentEntryRosters.entryGroupId, opts.entryGroupId),
        eq(tournamentEntryRosters.rosterType, opts.rosterType),
      ),
    )
    .orderBy(desc(tournamentEntryRosters.version))

  const version = (existingRosters[0]?.version ?? 0) + 1
  let supersededRoster: (typeof existingRosters)[number] | null = null
  if (opts.revision.kind === 'initial') {
    if (existingRosters.length > 0) {
      throw new Error('初版として取り込めません。訂正または追加発表を指定してください')
    }
  } else if (opts.revision.kind === 'correction') {
    const targetRosterId = opts.revision.targetRosterId
    supersededRoster =
      existingRosters.find((candidate) => candidate.id === targetRosterId) ?? null
    if (!supersededRoster || supersededRoster.supersededAt !== null) {
      throw new Error('訂正対象の有効な名簿が見つかりません')
    }
  }

  // 2. 新版を作成してから旧版を閉じる。同一トランザクションなので途中状態は公開されない。
  const [roster] = await tx
    .insert(tournamentEntryRosters)
    .values({
      entryGroupId: opts.entryGroupId,
      rosterType: opts.rosterType,
      version,
      publishedAt: opts.publishedAt ?? null,
      sourceAttachmentId: opts.sourceAttachmentId ?? null,
      sourceMailMessageId: opts.sourceMailMessageId ?? null,
      supersedesRosterId: supersededRoster?.id ?? null,
      approvedAt: opts.approvedByUserId ? new Date() : null,
      approvedByUserId: opts.approvedByUserId ?? null,
      note: opts.note ?? null,
    })
    .returning({ id: tournamentEntryRosters.id })
  const rosterId = roster!.id

  if (supersededRoster) {
    await tx
      .update(tournamentEntryRosters)
      .set({ supersededAt: new Date(), updatedAt: new Date() })
      .where(eq(tournamentEntryRosters.id, supersededRoster.id))
  }

  // 3. 会員突合用に全会員の正規化名→user_id マップを作る（**単独一致のみ**採用）。
  const memberByName = await loadUniqueMemberNameMap(tx)
  const touchedPlayerIds = new Set<number>()

  // 4. 各行: player 解決 + user 突合 + insert。
  let matchedUserCount = 0
  for (const e of parsed.entries) {
    const normalizedName = normalizePlayerName(e.rawName)
    const playerId = await getOrCreatePlayer(tx, normalizedName, e.rawName, e.rawKana)
    const userId = resolveUniqueMemberId(memberByName, normalizedName)
    touchedPlayerIds.add(playerId)
    if (userId) matchedUserCount++

    await tx.insert(tournamentEntryRosterEntries).values({
      rosterId,
      playerId,
      userId,
      grade: e.grade,
      rawName: e.rawName,
      rawKana: e.rawKana,
      rawAffiliation: e.rawAffiliation,
      rawDan: e.rawDan,
      status: mapEntryStatus(e.statusText, opts.rosterType),
      selectionOutcome: e.selectionOutcome,
      selectionExempt: e.selectionExempt,
      seqNo: e.seqNo,
    })
  }

  await syncPlayersToUniqueMembers(tx, [...touchedPlayerIds], memberByName)

  return {
    rosterId,
    version,
    supersededRosterId: supersededRoster?.id ?? null,
    entryCount: parsed.entries.length,
    matchedUserCount,
  }
}

/**
 * Mark an existing roster as a confirmed publication without cloning it.
 * Applicant rosters are intentionally allowed for explicit no-lottery dual use.
 */
export async function publishConfirmedRoster(
  tx: DbLike,
  input: { editionId: number; grade: RosterGrade; rosterId: number; publishedAt: string },
): Promise<number> {
  const [publication] = await tx
    .insert(tournamentConfirmedRosterPublications)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: tournamentConfirmedRosterPublications.id })
  if (publication) return publication.id

  const [existing] = await tx
    .select({
      id: tournamentConfirmedRosterPublications.id,
      publishedAt: tournamentConfirmedRosterPublications.publishedAt,
    })
    .from(tournamentConfirmedRosterPublications)
    .where(
      and(
        eq(tournamentConfirmedRosterPublications.editionId, input.editionId),
        eq(tournamentConfirmedRosterPublications.grade, input.grade),
        eq(tournamentConfirmedRosterPublications.rosterId, input.rosterId),
      ),
    )
    .limit(1)
  if (!existing) throw new Error('確定名簿発表を保存できませんでした')
  if (existing.publishedAt !== input.publishedAt) {
    throw new Error('同じ名簿の確定発表日が既存データと一致しません')
  }
  return existing.id
}

/**
 * player get-or-create（同定キー＝正規化姓名のみ。result-import/materialize と同型）。
 * affiliation は player に持たせない（人 × 大会の属性）。所属は roster_entry の raw に残る。
 */
async function getOrCreatePlayer(
  tx: DbLike,
  normalizedName: string,
  rawName: string,
  rawKana: string | null,
): Promise<number> {
  const where = eq(players.normalizedName, normalizedName)
  const existing = await tx.select({ id: players.id }).from(players).where(where).limit(1)
  if (existing.length > 0) return existing[0]!.id

  const inserted = await tx
    .insert(players)
    .values({
      displayName: rawName,
      normalizedName,
      nameKana: rawKana,
      affiliation: null,
      prefecture: null,
    })
    .onConflictDoNothing()
    .returning({ id: players.id })
  if (inserted.length > 0) return inserted[0]!.id

  const reselect = await tx.select({ id: players.id }).from(players).where(where).limit(1)
  return reselect[0]!.id
}

/**
 * ファイルの状態テキスト→roster_entry_status。無ければ roster_type の既定
 * （applicant→applied / confirmed→confirmed）。
 */
export function mapEntryStatus(statusText: string | null, rosterType: RosterType): RosterEntryStatus {
  const t = (statusText ?? '').normalize('NFKC')
  // Codex R1 blocker: 繰上表記（繰上/繰り上）を先に共通判定し、辞退/不参加を carried_up より前で
  // 評価する。でないと「繰り上げ辞退」が carried_up（出場）として保存され状態が逆になる。
  const isCarryUp = t.includes('繰上') || t.includes('繰り上')
  if (isCarryUp && (t.includes('辞退') || t.includes('不参加'))) return 'carry_up_declined'
  if (isCarryUp) return 'carried_up'
  if (t.includes('辞退') || t.includes('取消') || t.includes('取り消') || t.includes('欠場') || t.includes('キャンセル')) {
    return 'cancelled'
  }
  if (t.includes('確定')) return 'confirmed'
  return rosterType === 'applicant' ? 'applied' : 'confirmed'
}
