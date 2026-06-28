import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  players,
  users,
  tournamentEntryRosters,
  tournamentEntryRosterEntries,
} from '@kagetra/shared/schema'
import { normalizePlayerName } from '@kagetra/mail-worker/result-import/normalize'
import type { ParsedRoster } from './parser'

type DbLike = NodePgDatabase<typeof schema>

export type RosterType = 'applicant' | 'confirmed'
export type RosterEntryStatus =
  | 'applied'
  | 'confirmed'
  | 'carried_up'
  | 'carry_up_declined'
  | 'cancelled'

export interface MaterializeRosterOpts {
  eventId: number
  rosterType: RosterType
  publishedAt?: string | null
  sourceAttachmentId?: number | null
  note?: string | null
}

export interface MaterializeRosterResult {
  rosterId: number
  entryCount: number
  /** entry.user_id が解決できた行数（自会員の突合数）。 */
  matchedUserCount: number
}

/**
 * 名簿ファイルの解析結果を tournament_entry_rosters / _entries へ materialize する（caller の tx 内）。
 *
 * - **再取込は置換**: 同 (event_id, roster_type) の既存名簿を削除（cascade で entries も）→ 作り直す。
 *   繰上りの反映は確定名簿の再取込で行う（UNIQUE(event_id, roster_type) と整合）。
 * - 各行を players に解決（姓名のみ同定・onConflictDoNothing、result-import と同型）。所属は player に
 *   持たせず raw_* に保持（[[impl_player_identity_name_only]]）。
 * - 会員突合: 正規化姓名が会員(users.name)に**単独一致**したとき entry.user_id を張る（曖昧は null）。
 */
export async function materializeRoster(
  tx: DbLike,
  parsed: ParsedRoster,
  opts: MaterializeRosterOpts,
): Promise<MaterializeRosterResult> {
  // 1. 置換: 既存の同型名簿を削除（cascade で entries も消える）。
  await tx
    .delete(tournamentEntryRosters)
    .where(
      and(
        eq(tournamentEntryRosters.eventId, opts.eventId),
        eq(tournamentEntryRosters.rosterType, opts.rosterType),
      ),
    )

  // 2. 名簿ヘッダ作成。
  const [roster] = await tx
    .insert(tournamentEntryRosters)
    .values({
      eventId: opts.eventId,
      rosterType: opts.rosterType,
      publishedAt: opts.publishedAt ?? null,
      sourceAttachmentId: opts.sourceAttachmentId ?? null,
      note: opts.note ?? null,
    })
    .returning({ id: tournamentEntryRosters.id })
  const rosterId = roster!.id

  // 3. 会員突合用に全会員の正規化名→user_id マップを作る（**単独一致のみ**採用）。
  const memberRows = await tx.select({ id: users.id, name: users.name }).from(users)
  const userByName = new Map<string, string | null>() // 正規化名 → userId（衝突は null）
  for (const m of memberRows) {
    if (!m.name) continue
    const key = normalizePlayerName(m.name)
    if (!key) continue
    userByName.set(key, userByName.has(key) ? null : m.id)
  }

  // 4. 各行: player 解決 + user 突合 + insert。
  let matchedUserCount = 0
  for (const e of parsed.entries) {
    const normalizedName = normalizePlayerName(e.rawName)
    const playerId = await getOrCreatePlayer(tx, normalizedName, e.rawName, e.rawKana)
    const userId = userByName.get(normalizedName) ?? null
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
      seqNo: e.seqNo,
    })
  }

  return { rosterId, entryCount: parsed.entries.length, matchedUserCount }
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
