import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  entryGroups,
  eventLineBroadcasts,
  events,
  lineChannels,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createMailMessage, createTournamentDraft } from '@/test-utils/seed'
import {
  applyEntryGroupChange,
  clusterEventsByEntryGroup,
  deleteGroupIfEmpty,
  listGroupSiblings,
  listMergeCandidateGroups,
  propagateFieldsToGroup,
} from './entry-groups'

/**
 * AC-2（SQL 側）: migration 0045 の backfill が使うクラスタ式
 * （`GROUP BY tournament_draft_id, entry_deadline`）が、規則の正である純関数
 * `clusterEventsByEntryGroup` と**同じ結果**になることを実 DB で固定する。
 *
 * なぜ必要か: vitest の global-setup は `drizzle-kit push --force` で**最終スキーマを
 * 直接 push する**ため、migration ファイルの backfill SQL はテストスイートで一度も
 * 実行されない。規則が plpgsql と TS の2箇所にある以上、意味論のズレ
 * （特に `IS NOT DISTINCT FROM` / `GROUP BY` の NULL 同値）はここでしか検出できない。
 */

interface Shape {
  title: string
  tournamentDraftId: number | null
  entryDeadline: string | null
}

/** migration 0045 の backfill と同じクラスタ式で、draft 由来イベントを束ねる。 */
async function clusterViaSql(): Promise<string[][]> {
  const result = await testDb.execute<{ titles: string[] }>(sql`
    SELECT array_agg(title ORDER BY title) AS titles
      FROM events
     WHERE tournament_draft_id IS NOT NULL
     GROUP BY tournament_draft_id, entry_deadline
     ORDER BY min(title)
  `)
  return result.rows.map((r) => r.titles)
}

/** Bot チャンネルを1個作り、`entryGroupId` へ割り当てる（`assigned_entry_group_id` は UNIQUE）。 */
async function seedAssignedChannel(entryGroupId: number) {
  const unique = crypto.randomUUID()
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${unique}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: '@bot',
      purpose: 'event_broadcast',
      status: 'active',
      assignedEntryGroupId: entryGroupId,
    })
    .returning()
  return channel!
}

/** グループへの linked な LINE 紐付け（`event_line_broadcasts.entry_group_id` は UNIQUE）。 */
async function seedGroupBinding(entryGroupId: number) {
  const channel = await seedAssignedChannel(entryGroupId)
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel.id,
    status: 'linked',
    lineGroupId: `G${crypto.randomUUID().slice(0, 8)}`,
    linkedAt: new Date(),
  })
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('backfill クラスタ式（SQL）と純関数の一致 — AC-2', () => {
  it('多摩5件＋秋田2件＋NULL締切2件で、SQL と純関数が同じ束ね方になる', async () => {
    // tournament_drafts.message_id は UNIQUE なので、draft ごとに別のメールを作る。
    const tamaMail = await createMailMessage({})
    const akitaMail = await createMailMessage({})
    const tama = await createTournamentDraft({ messageId: tamaMail.id })
    const akita = await createTournamentDraft({ messageId: akitaMail.id })

    const shapes: Shape[] = [
      { title: '多摩A', tournamentDraftId: tama.id, entryDeadline: '2026-07-11' },
      { title: '多摩B', tournamentDraftId: tama.id, entryDeadline: '2026-07-11' },
      { title: '多摩C', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '多摩D', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '多摩E', tournamentDraftId: tama.id, entryDeadline: '2026-07-05' },
      { title: '秋田ABCD', tournamentDraftId: akita.id, entryDeadline: '2026-07-26' },
      { title: '秋田DE', tournamentDraftId: akita.id, entryDeadline: '2026-08-30' },
      // 同一 draft・締切 NULL 同士 → SQL の GROUP BY も NULL をまとめる。
      { title: '締切未定1', tournamentDraftId: akita.id, entryDeadline: null },
      { title: '締切未定2', tournamentDraftId: akita.id, entryDeadline: null },
    ]
    for (const s of shapes) {
      await createEvent({
        title: s.title,
        eventDate: '2026-09-01',
        tournamentDraftId: s.tournamentDraftId,
        entryDeadline: s.entryDeadline,
      })
    }

    const viaSql = (await clusterViaSql()).map((titles) => [...titles].sort())
    const viaFn = clusterEventsByEntryGroup(shapes)
      .map((c) => c.map((e) => e.title).sort())
    // 並び順に依存しない集合比較（クラスタの並びは ORDER BY min(title) と入力順で違いうる）。
    const norm = (groups: string[][]) =>
      groups.map((g) => g.join(',')).sort()

    expect(norm(viaSql)).toEqual(norm(viaFn))
    // 期待する形そのものも固定しておく（多摩→2・秋田→2＋NULL締切→1）。
    expect(norm(viaSql)).toEqual(
      norm([
        ['多摩A', '多摩B'],
        ['多摩C', '多摩D', '多摩E'],
        ['秋田ABCD'],
        ['秋田DE'],
        ['締切未定1', '締切未定2'],
      ]),
    )
  })

  it('IS NOT DISTINCT FROM は NULL 同士を一致とみなす（backfill の UPDATE 条件）', async () => {
    const result = await testDb.execute<{ null_eq: boolean; null_vs_value: boolean }>(sql`
      SELECT (NULL::date IS NOT DISTINCT FROM NULL::date) AS null_eq,
             (NULL::date IS NOT DISTINCT FROM DATE '2026-07-05') AS null_vs_value
    `)
    expect(result.rows[0]?.null_eq).toBe(true)
    expect(result.rows[0]?.null_vs_value).toBe(false)
  })

  it('draft 無しのイベントはクラスタ式の対象外（シングルトン扱い）', async () => {
    await createEvent({ title: '会内練習会', tournamentDraftId: null })
    await createEvent({ title: '女流BC', tournamentDraftId: null })

    // WHERE tournament_draft_id IS NOT NULL なので SQL 側の束ねには現れない。
    expect(await clusterViaSql()).toEqual([])
    // 純関数側では 1 件 1 クラスタ。
    expect(
      clusterEventsByEntryGroup([
        { title: '会内練習会', tournamentDraftId: null, entryDeadline: null },
        { title: '女流BC', tournamentDraftId: null, entryDeadline: null },
      ]).map((c) => c.length),
    ).toEqual([1, 1])
  })

  it('createEvent は既定でシングルトングループを自動生成する（AC-1）', async () => {
    const a = await createEvent({ title: 'A' })
    const b = await createEvent({ title: 'B' })

    expect(a.entryGroupId).toBeTypeOf('number')
    expect(b.entryGroupId).toBeTypeOf('number')
    expect(a.entryGroupId).not.toBe(b.entryGroupId)
  })

  it('entryGroupId を明示すれば複数イベントを同一グループに置ける', async () => {
    const first = await createEvent({ title: '多摩A' })
    const second = await createEvent({ title: '多摩B', entryGroupId: first.entryGroupId })

    expect(second.entryGroupId).toBe(first.entryGroupId)
  })
})

describe('listGroupSiblings', () => {
  it('同一グループの全イベントを開催日昇順で返す（自分自身を含む）', async () => {
    const group = await createEntryGroup()
    const b = await createEvent({ title: '多摩B', eventDate: '2026-07-12', entryGroupId: group.id })
    const a = await createEvent({ title: '多摩A', eventDate: '2026-07-11', entryGroupId: group.id })
    await createEvent({ title: '別グループ' }) // 別グループのノイズ

    const siblings = await listGroupSiblings(testDb, b.id)

    expect(siblings.map((s) => s.id)).toEqual([a.id, b.id])
    expect(siblings.map((s) => s.title)).toEqual(['多摩A', '多摩B'])
  })

  it('存在しないイベント id は空配列', async () => {
    expect(await listGroupSiblings(testDb, 999_999)).toEqual([])
  })
})

describe('deleteGroupIfEmpty — 条件付き空グループ削除', () => {
  it('events が0件のグループは削除される', async () => {
    const group = await createEntryGroup()

    await testDb.transaction(async (tx) => {
      await deleteGroupIfEmpty(tx, group.id)
    })

    const remaining = await testDb.select().from(entryGroups).where(eq(entryGroups.id, group.id))
    expect(remaining).toEqual([])
  })

  it('events が残っているグループは削除されない', async () => {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id })

    await testDb.transaction(async (tx) => {
      await deleteGroupIfEmpty(tx, group.id)
    })

    const remaining = await testDb.select().from(entryGroups).where(eq(entryGroups.id, group.id))
    expect(remaining).toHaveLength(1)
  })

  it('存在しないグループ id は no-op（例外を投げない）', async () => {
    await testDb.transaction(async (tx) => {
      await expect(deleteGroupIfEmpty(tx, 999_999)).resolves.toBeUndefined()
    })
  })

  // r1 review blocker: LINE 紐付け・名簿の FK は ON DELETE RESTRICT。events だけを見て
  // DELETE すると FK 違反で**呼び出し元のトランザクション全体**（＝付け替え）が
  // ロールバックする。要件 §3.2.6「紐付け・名簿はそのまま移動元に残る」に従い、
  // これらを持つグループは events 0件でも削除しない。
  it('r1: LINE 紐付けを持つグループは events 0件でも削除されない', async () => {
    const group = await createEntryGroup()
    await seedGroupBinding(group.id)

    await testDb.transaction(async (tx) => {
      await deleteGroupIfEmpty(tx, group.id)
    })

    const remaining = await testDb.select().from(entryGroups).where(eq(entryGroups.id, group.id))
    expect(remaining).toHaveLength(1)
  })

  it('r1: 名簿を持つグループは events 0件でも削除されない', async () => {
    const group = await createEntryGroup()
    await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: group.id, rosterType: 'applicant', version: 1 })

    await testDb.transaction(async (tx) => {
      await deleteGroupIfEmpty(tx, group.id)
    })

    const remaining = await testDb.select().from(entryGroups).where(eq(entryGroups.id, group.id))
    expect(remaining).toHaveLength(1)
  })

  it('r1: Bot チャンネルが割当済みのグループは events 0件でも削除されない', async () => {
    const group = await createEntryGroup()
    await seedAssignedChannel(group.id)

    await testDb.transaction(async (tx) => {
      await deleteGroupIfEmpty(tx, group.id)
    })

    const remaining = await testDb.select().from(entryGroups).where(eq(entryGroups.id, group.id))
    expect(remaining).toHaveLength(1)
  })
})

describe('applyEntryGroupChange — 付け替え（単独化/合流）', () => {
  it("action='keep' は entryGroupId を変えない", async () => {
    const event = await createEvent({})
    const result = await testDb.transaction((tx) => applyEntryGroupChange(tx, event.id, 'keep', null))
    expect(result.entryGroupId).toBe(event.entryGroupId)
  })

  it('単独化: 複数日のグループから離脱すると新しいシングルトングループへ移り、移動元は残る', async () => {
    const oldGroup = await createEntryGroup()
    const a = await createEvent({ title: '多摩A', entryGroupId: oldGroup.id })
    const b = await createEvent({ title: '多摩B', entryGroupId: oldGroup.id })

    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, a.id, 'standalone', null),
    )

    expect(result.entryGroupId).not.toBe(oldGroup.id)
    const [updatedA] = await testDb.select().from(events).where(eq(events.id, a.id))
    expect(updatedA!.entryGroupId).toBe(result.entryGroupId)
    // 移動元グループには b が残っているので削除されない。
    const remainingOldGroup = await testDb
      .select()
      .from(entryGroups)
      .where(eq(entryGroups.id, oldGroup.id))
    expect(remainingOldGroup).toHaveLength(1)
    const [updatedB] = await testDb.select().from(events).where(eq(events.id, b.id))
    expect(updatedB!.entryGroupId).toBe(oldGroup.id)
  })

  it('単独化: 既に単独（グループ内が自分だけ）なら no-op（新しいグループを作らない）', async () => {
    const event = await createEvent({})
    const originalGroupId = event.entryGroupId

    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, event.id, 'standalone', null),
    )

    expect(result.entryGroupId).toBe(originalGroupId)
  })

  // 「単独化」で移動元が空になるのは常に「既に単独」no-op ケースと重なる（1件のグループから
  // 離脱すると必ず0件になるが、その場合は上の no-op が先に効いて何もしない）。「最後の1件が
  // 抜けた空グループの自動削除」を実際に踏むのは次の「合流」ケース（既存の別グループへ吸収され、
  // 移動元の単独グループが空になる）。

  it('合流: 既存グループへ移動し、移動元は空になれば削除される', async () => {
    const target = await createEntryGroup()
    await createEvent({ title: '合流先', entryGroupId: target.id })
    const event = await createEvent({ title: '単独イベント' })
    const oldGroupId = event.entryGroupId

    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, event.id, 'merge', target.id),
    )

    expect(result.entryGroupId).toBe(target.id)
    const [updated] = await testDb.select().from(events).where(eq(events.id, event.id))
    expect(updated!.entryGroupId).toBe(target.id)
    const remainingOldGroup = await testDb
      .select()
      .from(entryGroups)
      .where(eq(entryGroups.id, oldGroupId))
    expect(remainingOldGroup).toEqual([])
  })

  // r1 review blocker: RESTRICT FK を持つ依存行があるシングルトンの合流。以前は
  // 空グループの DELETE が FK 違反になり、合流そのものがロールバックしていた。
  it('r1: LINE 紐付けを持つシングルトンの合流は成功し、移動元グループと紐付けが残る', async () => {
    const target = await createEntryGroup()
    await createEvent({ title: '合流先', entryGroupId: target.id })
    const event = await createEvent({ title: '単独イベント' })
    const oldGroupId = event.entryGroupId
    await seedGroupBinding(oldGroupId)

    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, event.id, 'merge', target.id),
    )

    // 合流はロールバックせずに成立する。
    expect(result.entryGroupId).toBe(target.id)
    const [updated] = await testDb.select().from(events).where(eq(events.id, event.id))
    expect(updated!.entryGroupId).toBe(target.id)
    // 移動元グループと紐付けは残る（要件 §3.2.6）。
    const remainingOldGroup = await testDb
      .select()
      .from(entryGroups)
      .where(eq(entryGroups.id, oldGroupId))
    expect(remainingOldGroup).toHaveLength(1)
    const binding = await testDb
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.entryGroupId, oldGroupId))
    expect(binding).toHaveLength(1)
  })

  it('r1: 名簿を持つシングルトンの合流は成功し、名簿は移動元グループに残る', async () => {
    const target = await createEntryGroup()
    await createEvent({ title: '合流先', entryGroupId: target.id })
    const event = await createEvent({ title: '単独イベント' })
    const oldGroupId = event.entryGroupId
    await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: oldGroupId, rosterType: 'applicant', version: 1 })

    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, event.id, 'merge', target.id),
    )

    expect(result.entryGroupId).toBe(target.id)
    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.entryGroupId, oldGroupId))
    expect(rosters).toHaveLength(1)
  })

  it('合流: 移動元に他のイベントが残っていれば移動元グループは削除されない', async () => {
    const target = await createEntryGroup()
    await createEvent({ title: '合流先', entryGroupId: target.id })
    const oldGroup = await createEntryGroup()
    const moving = await createEvent({ title: '多摩A', entryGroupId: oldGroup.id })
    const staying = await createEvent({ title: '多摩B', entryGroupId: oldGroup.id })

    await testDb.transaction((tx) => applyEntryGroupChange(tx, moving.id, 'merge', target.id))

    const remainingOldGroup = await testDb
      .select()
      .from(entryGroups)
      .where(eq(entryGroups.id, oldGroup.id))
    expect(remainingOldGroup).toHaveLength(1)
    const [updatedStaying] = await testDb.select().from(events).where(eq(events.id, staying.id))
    expect(updatedStaying!.entryGroupId).toBe(oldGroup.id)
  })

  it('合流: 合流先が現在のグループと同じなら no-op', async () => {
    const event = await createEvent({})
    const result = await testDb.transaction((tx) =>
      applyEntryGroupChange(tx, event.id, 'merge', event.entryGroupId),
    )
    expect(result.entryGroupId).toBe(event.entryGroupId)
  })

  it('合流: 実在しない合流先 id は再検証で拒否される（クライアントの申告を信用しない）', async () => {
    const event = await createEvent({})
    await expect(
      testDb.transaction((tx) => applyEntryGroupChange(tx, event.id, 'merge', 999_999)),
    ).rejects.toThrow('合流先のグループが見つかりません')
  })
})

describe('propagateFieldsToGroup — 締切・支払い系の伝播', () => {
  it('選択した同グループの日にのみ変更後の値を保存する', async () => {
    const group = await createEntryGroup()
    const a = await createEvent({
      title: '多摩A',
      entryGroupId: group.id,
      entryDeadline: '2026-07-01',
    })
    const b = await createEvent({
      title: '多摩B',
      entryGroupId: group.id,
      entryDeadline: '2026-07-01',
    })
    const c = await createEvent({
      title: '多摩C（対象外グループ）',
      entryDeadline: '2026-07-01',
    })

    await testDb.transaction((tx) =>
      propagateFieldsToGroup(tx, {
        groupId: group.id,
        excludeEventId: a.id,
        targetEventIds: [b.id, c.id], // c は別グループなので再検証で弾かれるはず
        changed: { entryDeadline: '2026-07-10' },
      }),
    )

    const [updatedB] = await testDb.select().from(events).where(eq(events.id, b.id))
    const [updatedC] = await testDb.select().from(events).where(eq(events.id, c.id))
    expect(updatedB!.entryDeadline).toBe('2026-07-10')
    // 同一グループでない c は re-verification で弾かれ、元の値のまま。
    expect(updatedC!.entryDeadline).toBe('2026-07-01')
  })

  it('日固有フィールドは changed に含まれないため上書きされない（呼び出し側の責務だが型でも保証）', async () => {
    const group = await createEntryGroup()
    const a = await createEvent({ title: '多摩A', entryGroupId: group.id })
    const b = await createEvent({ title: '多摩B', entryGroupId: group.id, capacity: 16 })

    await testDb.transaction((tx) =>
      propagateFieldsToGroup(tx, {
        groupId: group.id,
        excludeEventId: a.id,
        targetEventIds: [b.id],
        changed: { paymentMethod: '銀行振込' },
      }),
    )

    const [updatedB] = await testDb.select().from(events).where(eq(events.id, b.id))
    expect(updatedB!.paymentMethod).toBe('銀行振込')
    expect(updatedB!.capacity).toBe(16) // 日固有フィールドは不変
  })

  it('changed が空なら no-op', async () => {
    const group = await createEntryGroup()
    const a = await createEvent({ entryGroupId: group.id })
    const b = await createEvent({ entryGroupId: group.id, entryMethod: '既存の方法' })

    await testDb.transaction((tx) =>
      propagateFieldsToGroup(tx, {
        groupId: group.id,
        excludeEventId: a.id,
        targetEventIds: [b.id],
        changed: {},
      }),
    )

    const [updatedB] = await testDb.select().from(events).where(eq(events.id, b.id))
    expect(updatedB!.entryMethod).toBe('既存の方法')
  })

  it('excludeEventId は対象から除かれる（自分自身は伝播で上書きしない）', async () => {
    const group = await createEntryGroup()
    const a = await createEvent({ entryGroupId: group.id, entryMethod: '手動編集済み' })

    await testDb.transaction((tx) =>
      propagateFieldsToGroup(tx, {
        groupId: group.id,
        excludeEventId: a.id,
        targetEventIds: [a.id],
        changed: { entryMethod: '伝播された値' },
      }),
    )

    const [updatedA] = await testDb.select().from(events).where(eq(events.id, a.id))
    expect(updatedA!.entryMethod).toBe('手動編集済み')
  })
})

describe('listMergeCandidateGroups — 合流先候補', () => {
  it('同一 tournamentDraftId 由来のグループを優先し、それ以外は開催日の近さで並べる', async () => {
    const mail = await createMailMessage({})
    const draft = await createTournamentDraft({ messageId: mail.id })

    // 自分自身も同じ draft 由来（多摩A/多摩B のような分割イベントの片方という想定）。
    const self = await createEvent({
      title: '対象イベント',
      eventDate: '2026-07-20',
      tournamentDraftId: draft.id,
    })

    const sameDraftGroup = await createEntryGroup()
    await createEvent({
      title: '同一draft由来',
      eventDate: '2026-12-01', // 遠い日付でも draft 一致が優先されるはず
      tournamentDraftId: draft.id,
      entryGroupId: sameDraftGroup.id,
    })

    const nearGroup = await createEntryGroup()
    await createEvent({ title: '開催日が近い', eventDate: '2026-07-21', entryGroupId: nearGroup.id })

    const farGroup = await createEntryGroup()
    await createEvent({ title: '開催日が遠い', eventDate: '2030-01-01', entryGroupId: farGroup.id })

    const candidates = await listMergeCandidateGroups(testDb, self.id, '2026-07-27')

    expect(candidates.map((c) => c.groupId)).toEqual([sameDraftGroup.id, nearGroup.id, farGroup.id])
  })

  it('自分自身のグループは候補に含まれない', async () => {
    const self = await createEvent({ title: '対象イベント' })
    const candidates = await listMergeCandidateGroups(testDb, self.id, '2026-07-27')
    expect(candidates.some((c) => c.groupId === self.entryGroupId)).toBe(false)
  })

  it('AC-3: 候補グループの表示名が導出不能なら代表イベントのタイトルへフォールバックする', async () => {
    const self = await createEvent({ title: '対象イベント', eventDate: '2026-07-20' })

    // 共通接頭辞+級文字のパターンに合わず deriveEntryGroupName が null を返すグループ。
    // 「開催日が近い順」規則により、未来側で最も近い '秋田ABCD'（2026-07-25）が代表になる。
    const mixedGroup = await createEntryGroup()
    await createEvent({
      title: '秋田ABCD',
      eventDate: '2026-07-25',
      entryGroupId: mixedGroup.id,
    })
    await createEvent({
      title: '多摩E',
      eventDate: '2026-08-01',
      entryGroupId: mixedGroup.id,
    })

    const candidates = await listMergeCandidateGroups(testDb, self.id, '2026-07-20')
    const mixed = candidates.find((c) => c.groupId === mixedGroup.id)

    expect(mixed?.name).toBe('秋田ABCD')
    expect(mixed?.representativeEventDate).toBe('2026-07-25')
  })
})
