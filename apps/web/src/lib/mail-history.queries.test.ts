import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventBroadcastMessages,
  eventLineBroadcasts,
  lineChannels,
  mailAttachments,
  mailMessages,
  resultDrafts,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createMailMessage, createTournamentDraft } from '@/test-utils/seed'
import { loadHistories, loadHistoryInputs } from './mail-history.queries'

/**
 * mail-history.queries.ts の結合テスト（実 DB）。requirements.md §3.4。
 * DB シードのやり方は entry-groups.sql.test.ts を踏襲する。
 */

/** `event_broadcast` 用チャンネルを1件作る（`channel_id` UNIQUE なので都度ランダム化）。 */
async function seedChannel() {
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
    })
    .returning()
  if (!channel) throw new Error('Failed to insert test line channel')
  return channel
}

/** `event_line_broadcasts` を1件作る（`entry_group_id` UNIQUE）。 */
async function seedEventLineBroadcast(entryGroupId: number) {
  const channel = await seedChannel()
  const [broadcast] = await testDb
    .insert(eventLineBroadcasts)
    .values({
      entryGroupId,
      lineChannelId: channel.id,
      status: 'linked',
      lineGroupId: `G${crypto.randomUUID().slice(0, 8)}`,
      linkedAt: new Date(),
    })
    .returning()
  if (!broadcast) throw new Error('Failed to insert test event line broadcast')
  return broadcast
}

async function attachFiles(mailId: number, count: number) {
  for (let i = 0; i < count; i++) {
    await testDb.insert(mailAttachments).values({
      mailMessageId: mailId,
      filename: `attachment-${i}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 100,
      data: Buffer.from('x'),
    })
  }
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('loadHistoryInputs — H1（AC-12b）', () => {
  it('events.tournament_draft_id の逆参照が0件でも tournament_drafts.event_id から引ける', async () => {
    const mail = await createMailMessage({})
    const directEvent = await createEvent({ title: '訂正版イベント', eventDate: '2026-08-02' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
      approvedAt: new Date('2026-08-02T00:00:00Z'),
      eventId: directEvent.id,
    })

    const inputs = await loadHistoryInputs(testDb, [mail.id])
    const input = inputs.get(mail.id)

    expect(input?.draft?.events.map((e) => e.id)).toEqual([directEvent.id])
    expect(draft.status).toBe('approved') // シード確認
  })

  it('逆参照(events.tournament_draft_id)と直接参照(tournament_drafts.event_id)の和集合になり、重複は除かれる', async () => {
    const mail = await createMailMessage({})
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
      approvedAt: new Date('2026-08-02T00:00:00Z'),
    })
    const splitA = await createEvent({
      title: '多摩A',
      eventDate: '2026-07-11',
      tournamentDraftId: draft.id,
      tournamentDraftUnitKey: 'A',
    })
    const splitB = await createEvent({
      title: '多摩B',
      eventDate: '2026-07-12',
      tournamentDraftId: draft.id,
      tournamentDraftUnitKey: 'B',
    })
    // event_id を splitA と同じイベントに向け、和集合が重複排除されることを確認する。
    await testDb.update(tournamentDrafts).set({ eventId: splitA.id }).where(eq(tournamentDrafts.id, draft.id))

    const inputs = await loadHistoryInputs(testDb, [mail.id])
    const input = inputs.get(mail.id)

    const ids = input?.draft?.events.map((e) => e.id).sort((a, b) => a - b)
    expect(ids).toEqual([splitA.id, splitB.id].sort((a, b) => a - b))
  })

  it('status が approved 以外のドラフトは H1 対象にならない', async () => {
    const mail = await createMailMessage({})
    await createTournamentDraft({ messageId: mail.id, status: 'rejected', rejectedAt: new Date() })

    const inputs = await loadHistoryInputs(testDb, [mail.id])
    expect(inputs.get(mail.id)?.draft).toBeNull()
  })
})

describe('loadHistoryInputs — H2（AC-13, AC-13b, AC-15）', () => {
  it('status=sent のみ拾い、pending/failed/partial は出さない', async () => {
    const group = await createEntryGroup()
    await createEvent({ title: '対象大会', eventDate: '2026-08-04', entryGroupId: group.id })
    const broadcastBinding = await seedEventLineBroadcast(group.id)

    const sentMail = await createMailMessage({})
    const pendingMail = await createMailMessage({})
    const failedMail = await createMailMessage({})
    const partialMail = await createMailMessage({})

    await testDb.insert(eventBroadcastMessages).values([
      {
        eventLineBroadcastId: broadcastBinding.id,
        mailMessageId: sentMail.id,
        status: 'sent',
        sentAt: new Date('2026-08-04T00:00:00Z'),
        includeBody: true,
      },
      { eventLineBroadcastId: broadcastBinding.id, mailMessageId: pendingMail.id, status: 'pending' },
      { eventLineBroadcastId: broadcastBinding.id, mailMessageId: failedMail.id, status: 'failed' },
      { eventLineBroadcastId: broadcastBinding.id, mailMessageId: partialMail.id, status: 'partial' },
    ])

    const inputs = await loadHistoryInputs(testDb, [
      sentMail.id,
      pendingMail.id,
      failedMail.id,
      partialMail.id,
    ])

    expect(inputs.get(sentMail.id)?.broadcasts).toHaveLength(1)
    expect(inputs.get(pendingMail.id)?.broadcasts).toHaveLength(0)
    expect(inputs.get(failedMail.id)?.broadcasts).toHaveLength(0)
    expect(inputs.get(partialMail.id)?.broadcasts).toHaveLength(0)
  })

  it('添付件数はそのメールの添付総数（配信ごとではない）で、3ホップでイベントが解決される', async () => {
    const group = await createEntryGroup()
    const eventA = await createEvent({ title: '大会A', eventDate: '2026-08-01', entryGroupId: group.id })
    const eventB = await createEvent({ title: '大会B', eventDate: '2026-08-02', entryGroupId: group.id })

    const mail = await createMailMessage({})
    await attachFiles(mail.id, 3)

    // 同一メールが2つの broadcast binding（＝2つの大会グループ）へ配信された想定。
    const bindingA = await seedEventLineBroadcast(group.id)
    const otherGroup = await createEntryGroup()
    await createEvent({ title: '別大会', eventDate: '2026-08-05', entryGroupId: otherGroup.id })
    const bindingB = await seedEventLineBroadcast(otherGroup.id)

    await testDb.insert(eventBroadcastMessages).values([
      {
        eventLineBroadcastId: bindingA.id,
        mailMessageId: mail.id,
        status: 'sent',
        sentAt: new Date('2026-08-04T00:00:00Z'),
        includeBody: true,
      },
      {
        eventLineBroadcastId: bindingB.id,
        mailMessageId: mail.id,
        status: 'sent',
        sentAt: new Date('2026-08-05T00:00:00Z'),
        includeBody: false,
      },
    ])

    const inputs = await loadHistoryInputs(testDb, [mail.id])
    const broadcasts = inputs.get(mail.id)?.broadcasts ?? []

    expect(broadcasts).toHaveLength(2)
    // 添付総数はどちらの配信行でも同じ値（そのメールの添付総数）。
    for (const b of broadcasts) {
      expect(b.attachmentCount).toBe(3)
    }
    const groupABroadcast = broadcasts.find((b) => b.includeBody === true)
    expect(groupABroadcast?.events.map((e) => e.id).sort()).toEqual(
      [eventA.id, eventB.id].sort(),
    )
  })
})

describe('loadHistoryInputs — H3', () => {
  it('linked_event_id が指すイベントの entry_group 全イベントを引ける', async () => {
    const group = await createEntryGroup()
    const eventA = await createEvent({ title: '多摩A', eventDate: '2026-07-11', entryGroupId: group.id })
    const eventB = await createEvent({ title: '多摩B', eventDate: '2026-07-12', entryGroupId: group.id })

    const mail = await createMailMessage({ linkedEventId: eventA.id })

    const inputs = await loadHistoryInputs(testDb, [mail.id])
    const linkedEvents = inputs.get(mail.id)?.linkedEvents ?? []

    expect(linkedEvents.map((e) => e.id).sort((a, b) => a - b)).toEqual(
      [eventA.id, eventB.id].sort((a, b) => a - b),
    )
  })

  it('linked_event_id が無いメールは linkedEvents が空', async () => {
    const mail = await createMailMessage({})
    const inputs = await loadHistoryInputs(testDb, [mail.id])
    expect(inputs.get(mail.id)?.linkedEvents).toEqual([])
  })
})

describe('loadHistoryInputs — 定数回のクエリ（N+1 禁止）', () => {
  /** H1/H2/H3 の全分岐が有効になる1通ぶんの完全なシードを作り、mailId を返す。 */
  async function seedFullShapeMail(): Promise<number> {
    const directEvent = await createEvent({ title: '訂正版', eventDate: '2026-08-02' })
    const linkedGroup = await createEntryGroup()
    const linkedEvent = await createEvent({
      title: '紐付け大会',
      eventDate: '2026-07-19',
      entryGroupId: linkedGroup.id,
    })
    const mail = await createMailMessage({ linkedEventId: linkedEvent.id })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
      approvedAt: new Date('2026-08-02T00:00:00Z'),
      eventId: directEvent.id,
    })

    const broadcastGroup = await createEntryGroup()
    await createEvent({ title: '配信大会', eventDate: '2026-08-04', entryGroupId: broadcastGroup.id })
    const binding = await seedEventLineBroadcast(broadcastGroup.id)
    await testDb.insert(eventBroadcastMessages).values({
      eventLineBroadcastId: binding.id,
      mailMessageId: mail.id,
      status: 'sent',
      sentAt: new Date('2026-08-04T00:00:00Z'),
      includeBody: true,
    })
    await attachFiles(mail.id, 1)

    return mail.id
  }

  it('N=1 と N=10 で select 呼び出し回数が変わらない', async () => {
    const oneMailId = await seedFullShapeMail()
    const selectSpyOne = vi.spyOn(testDb, 'select')
    await loadHistoryInputs(testDb, [oneMailId])
    const oneCount = selectSpyOne.mock.calls.length
    selectSpyOne.mockRestore()

    await truncateAll()

    const tenMailIds: number[] = []
    for (let i = 0; i < 10; i++) {
      tenMailIds.push(await seedFullShapeMail())
    }
    const selectSpyTen = vi.spyOn(testDb, 'select')
    await loadHistoryInputs(testDb, tenMailIds)
    const tenCount = selectSpyTen.mock.calls.length
    selectSpyTen.mockRestore()

    expect(tenCount).toBe(oneCount)
  })

  it('mailIds 空配列で DB を叩かず空 Map', async () => {
    const selectSpy = vi.spyOn(testDb, 'select')
    const inputs = await loadHistoryInputs(testDb, [])
    expect(inputs.size).toBe(0)
    expect(selectSpy).not.toHaveBeenCalled()
    selectSpy.mockRestore()
  })
})

describe('loadHistories — 一覧・詳細の入口（H0 配線の結合確認）', () => {
  it('result_drafts が approved のメールは H0 行が出て「対応不要」に落ちない（AC-32）', async () => {
    const mail = await createMailMessage({})
    await testDb.insert(resultDrafts).values({
      messageId: mail.id,
      status: 'approved',
      approvedAt: new Date('2026-07-21T00:00:00Z'),
      extractedPayload: {},
      parserVersion: 'test-1.0',
    })
    // triage_status は既定 'unprocessed' のままだと H6 で空になってしまうため processed にする。
    await testDb
      .update(mailMessages)
      .set({ triageStatus: 'processed', triagedAt: new Date('2026-07-21T00:00:00Z') })
      .where(eq(mailMessages.id, mail.id))

    const histories = await loadHistories(testDb, [mail.id])
    const rows = histories.get(mail.id) ?? []

    expect(rows.map((r) => r.kind)).toEqual(['result_import'])
  })

  it('mailIds 空配列で空 Map', async () => {
    expect(await loadHistories(testDb, [])).toEqual(new Map())
  })
})
