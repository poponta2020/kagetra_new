import { and, eq, gte, inArray, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  events,
  eventLineBroadcasts,
  tournamentEntryRosterFiles,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { displayName } from '../entries/entry-board-utils'
import { todayInJst } from '@/lib/jst-date'
import { linkableEventCutoffStr } from './linkable-events'
import type { ProcessCandidateGroup } from './process-candidate-utils'

/**
 * mail-inbox-mailer (2026-08-02 改修: 統合処理フォーム) タスク2:
 * メール詳細の統合フォームで「対象の大会」候補（申込グループ単位）を1本にまとめる
 * ローダ（AC-5, AC-6, AC-7, AC-18）。種別ごとの絞り込みは `process-candidate-utils.ts`
 * の純関数が行うので、ここは種別を問わない基本条件の平ら DTO を返すだけ。
 *
 * `mail/[id]/page.tsx` の既存 `loadRosterAdoptableGroups()` を土台にしている
 * （表示名導出・グループ全イベント取得・採用済みファイル取得の規約は完全に同一）。
 * 差分は以下:
 *
 * - 母集団は「開催日 >= cutoff ∧ 非 cancelled」を満たす日を1つ以上持つグループ
 *   （**`kind='individual'` の条件を外す** — 未選択種別の紐付けは団体戦のみの
 *   グループも含む。個人戦限定は名簿種別だけの制約で、`process-candidate-utils.ts`
 *   の `listProcessCandidates` が担う）
 * - `days` は「非 cancelled」の全日を kind で絞らず詰める（cutoff もかけない）。
 *   名簿種別の級集合計算に必要な個人戦限定は client 側の `toRosterAdoptGroup` が行う
 * - `representativeEventId`（メールの `linked_event_id` に入る値）を新たに算出する
 */

export async function loadProcessCandidateGroups(): Promise<ProcessCandidateGroup[]> {
  const cutoffStr = linkableEventCutoffStr()
  const todayStr = todayInJst()

  // 母集団: 「開催日 >= cutoff ∧ 非 cancelled」を満たす日を1つ以上持つグループ。
  // ★ここでは kind='individual' を要求しない（未選択種別の紐付けは団体戦のみの
  // グループも含む — roster-file-adoption の基本条件との違い）。
  const qualifyingRows = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(and(gte(events.eventDate, cutoffStr), ne(events.status, 'cancelled')))
  const groupIds = [...new Set(qualifyingRows.map((r) => r.entryGroupId))]
  if (groupIds.length === 0) return []

  // グループの**全イベント**を引く（cancelled・団体戦・過去日も含む）。表示名の
  // 導出母集団を申込管理ボード・roster-file-adoption と揃えるため（表示対象で
  // 絞ると、過去の多摩A＋未来の多摩B のグループがここだけ「多摩B」になって
  // 他画面と食い違う）。通称ベースの表示名を組むので edition → series を
  // 2段 leftJoin する（edition_id は nullable）。
  const memberRows = await db
    .select({
      id: events.id,
      entryGroupId: events.entryGroupId,
      title: events.title,
      shortName: tournamentSeries.shortName,
      eventDate: events.eventDate,
      status: events.status,
      kind: events.kind,
      entryStatus: events.entryStatus,
      eligibleGrades: events.eligibleGrades,
    })
    .from(events)
    .leftJoin(tournamentSeriesEditions, eq(tournamentSeriesEditions.id, events.editionId))
    .leftJoin(tournamentSeries, eq(tournamentSeries.id, tournamentSeriesEditions.seriesId))
    .where(inArray(events.entryGroupId, groupIds))
    .orderBy(events.eventDate)

  const adoptedRows = await db
    .select({
      entryGroupId: tournamentEntryRosterFiles.entryGroupId,
      rosterType: tournamentEntryRosterFiles.rosterType,
      grades: tournamentEntryRosterFiles.grades,
    })
    .from(tournamentEntryRosterFiles)
    .where(inArray(tournamentEntryRosterFiles.entryGroupId, groupIds))

  // lineLinked: `apps/web/src/lib/line-broadcast.ts` の `loadActiveBinding` と
  // 完全に一致させる述語（`status='linked'` の行があり、かつ `lineGroupId` が
  // 空でないこと）。ズレると「UI では配信できるのに実際は no_active_binding で
  // スキップされる」／その逆が起きる。`lineGroupId` の空文字判定は
  // `loadActiveBinding` が JS の `if (!hit.lineGroupId)` で行っているのと
  // 同じ意味になるよう、SQL の IS NOT NULL ではなく TS 側で真偽判定する。
  const broadcastRows = await db
    .select({
      entryGroupId: eventLineBroadcasts.entryGroupId,
      lineGroupId: eventLineBroadcasts.lineGroupId,
    })
    .from(eventLineBroadcasts)
    .where(
      and(inArray(eventLineBroadcasts.entryGroupId, groupIds), eq(eventLineBroadcasts.status, 'linked')),
    )
  const lineLinkedGroupIds = new Set<number>()
  for (const row of broadcastRows) {
    if (row.lineGroupId) lineLinkedGroupIds.add(row.entryGroupId)
  }

  const membersByGroup = new Map<number, typeof memberRows>()
  for (const row of memberRows) {
    const arr = membersByGroup.get(row.entryGroupId)
    if (arr) arr.push(row)
    else membersByGroup.set(row.entryGroupId, [row])
  }

  const groups: (ProcessCandidateGroup & { sortDate: string })[] = []
  for (const groupId of groupIds) {
    const members = membersByGroup.get(groupId)
    if (!members || members.length === 0) continue

    // 表示名・並び順は「全日」を母集団にする既存規約のまま（roster-file-adoption /
    // 申込管理ボードと揃える）。
    const nameRepresentative = selectRepresentativeEvent(members, todayStr)
    if (!nameRepresentative) continue // members は空でないので理論上到達しない
    const titleName =
      deriveEntryGroupName(members.map((m) => m.title)) ?? nameRepresentative.title
    const groupDisplayName =
      deriveEntryGroupName(
        members.map((m) =>
          displayName({
            title: m.title,
            shortName: m.shortName,
            eligibleGrades: m.eligibleGrades,
          }),
        ),
      ) ?? titleName

    // representativeEventId（メールの linked_event_id に入る値）は「全日」とは
    // 別の母集団——「cutoff 以降 ∧ 非 cancelled」の日だけ——から選ぶ。これで
    // 値が必ず `validateLinkableEvent`（linkable-events.ts）を通る。
    const qualifyingDays = members.filter(
      (m) => m.eventDate >= cutoffStr && m.status !== 'cancelled',
    )
    const linkRepresentative = selectRepresentativeEvent(qualifyingDays, todayStr)
    if (!linkRepresentative) continue // groupId は qualifyingRows 由来なので理論上到達しない

    groups.push({
      groupId,
      displayName: groupDisplayName,
      representativeEventId: linkRepresentative.id,
      days: members
        .filter((m) => m.status !== 'cancelled')
        .map((m) => ({
          eventDate: m.eventDate,
          entryStatus: m.entryStatus,
          eligibleGrades: m.eligibleGrades,
          kind: m.kind,
        })),
      files: adoptedRows
        .filter((f) => f.entryGroupId === groupId)
        .map((f) => ({ rosterType: f.rosterType, grades: f.grades })),
      lineLinked: lineLinkedGroupIds.has(groupId),
      sortDate: nameRepresentative.eventDate,
    })
  }

  // 代表イベント（全日母集団）の開催日昇順 → groupId 昇順。既存
  // `loadRosterAdoptableGroups` と同じ並び順規約。
  groups.sort((a, b) =>
    a.sortDate === b.sortDate ? a.groupId - b.groupId : a.sortDate < b.sortDate ? -1 : 1,
  )
  return groups.map(({ sortDate: _sortDate, ...g }) => g)
}
