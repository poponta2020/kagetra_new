import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest'
import { eq } from 'drizzle-orm'
import { createEntryGroup } from '@/test-utils/seed'
import { sendGuidelinesOnLink } from './line-broadcast-guidelines'
import {
  attachmentShareTokens,
  eventBroadcastGuidelineAttachments,
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  lineChannels,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import { db } from './db'

let originalDryRun: string | undefined
let originalBaseUrl: string | undefined

beforeAll(() => {
  originalDryRun = process.env.LINE_NOTIFY_DRY_RUN
  originalBaseUrl = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://test.example.com'
})

afterAll(() => {
  if (originalBaseUrl == null) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = originalBaseUrl
})

async function resetDb() {
  // FK 順: guideline join → messages/tokens → broadcast → channels →
  // attachments → mails → events。
  await db.delete(eventBroadcastGuidelineAttachments)
  await db.delete(eventBroadcastMessages)
  await db.delete(attachmentShareTokens)
  await db.delete(eventLineBroadcasts)
  await db.delete(lineChannels)
  await db.delete(mailAttachments)
  await db.delete(mailMessages)
  await db.delete(events)
}

interface SeededBroadcast {
  broadcastId: number
  lineGroupId: string
  channelAccessToken: string
  mailMessageId: number
}

async function seedLinkedBroadcast(): Promise<SeededBroadcast> {
  const channelAccessToken = 'token-abc'
  const lineGroupId = 'C123456789'

  const channel = (
    await db
      .insert(lineChannels)
      .values({
        channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        channelSecret: 'secret',
        channelAccessToken,
        botId: '@kagetra-event-bot-test',
        purpose: 'event_broadcast',
        status: 'active',
      })
      .returning()
  )[0]!

  const entryGroupId = (await createEntryGroup()).id
  await db
    .insert(events)
    .values({ entryGroupId, title: 'テスト大会', eventDate: '2026-06-01' })
    .returning({ id: events.id })

  await db
    .update(lineChannels)
    .set({ assignedEntryGroupId: entryGroupId })
    .where(eq(lineChannels.id, channel.id))

  const broadcastId = (
    await db
      .insert(eventLineBroadcasts)
      .values({
        entryGroupId,
        lineChannelId: channel.id,
        status: 'linked',
        lineGroupId,
        linkedAt: new Date(),
      })
      .returning({ id: eventLineBroadcasts.id })
  )[0]!.id

  const mailMessageId = (
    await db
      .insert(mailMessages)
      .values({
        messageId: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromAddress: 'organiser@example.com',
        toAddresses: ['admin@kagetra'],
        subject: '〇〇杯 大会案内',
        receivedAt: new Date(),
        bodyText: '案内本文',
        status: 'ai_done',
      })
      .returning({ id: mailMessages.id })
  )[0]!.id

  return { broadcastId, lineGroupId, channelAccessToken, mailMessageId }
}

async function addSelectedAttachment(
  seed: SeededBroadcast,
  filename: string,
): Promise<number> {
  const data = Buffer.from('fake-bytes')
  const attachmentId = (
    await db
      .insert(mailAttachments)
      .values({
        mailMessageId: seed.mailMessageId,
        filename,
        contentType: 'application/pdf',
        sizeBytes: data.length,
        data,
      })
      .returning({ id: mailAttachments.id })
  )[0]!.id

  await db.insert(eventBroadcastGuidelineAttachments).values({
    eventLineBroadcastId: seed.broadcastId,
    mailAttachmentId: attachmentId,
  })
  return attachmentId
}

/** ok な Response もどきを返す、fetch シグネチャ付きモック。 */
function okFetch() {
  return vi.fn<typeof fetch>(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
      }) as unknown as Response,
  )
}

async function readGuidelinesSentAt(broadcastId: number): Promise<Date | null> {
  const row = await db
    .select({ guidelinesSentAt: eventLineBroadcasts.guidelinesSentAt })
    .from(eventLineBroadcasts)
    .where(eq(eventLineBroadcasts.id, broadcastId))
    .limit(1)
  return row[0]?.guidelinesSentAt ?? null
}

describe('sendGuidelinesOnLink', () => {
  beforeEach(async () => {
    await resetDb()
    delete process.env.LINE_NOTIFY_DRY_RUN
  })

  afterEach(() => {
    if (originalDryRun == null) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = originalDryRun
  })

  it('要綱として選択された各添付を 大会要綱タグ付き Flex カードで push し、guidelines_sent_at を刻む', async () => {
    const seed = await seedLinkedBroadcast()
    await addSelectedAttachment(seed, '要項.pdf')
    await addSelectedAttachment(seed, '振込先.pdf')
    const fetchImpl = okFetch()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0 },
    )

    expect(result.status).toBe('sent')
    expect(result.sentCount).toBe(2)
    expect(result.totalCount).toBe(2)

    // 1 バッチ (<=5) で 2 通送信。
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const init = fetchImpl.mock.calls[0]![1]!
    const body = JSON.parse(String(init.body))
    expect(body.to).toBe(seed.lineGroupId)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].type).toBe('flex')
    expect(body.messages[0].altText).toBe('📎【大会要綱】要項.pdf')
    // URL はカードの uri アクションに載り、テキスト露出しない。
    expect(JSON.stringify(body.messages[0].contents)).toContain(
      '/api/line-broadcast/attachments/',
    )
    expect(body.messages[1].altText).toBe('📎【大会要綱】振込先.pdf')
    // サイズ行が実際に描画される = octet_length が number として返っている
    // （sql<number> は未検証のアサーションなので、ここで型を固定する）。
    expect(JSON.stringify(body.messages[0].contents)).toMatch(
      /\d+ (B|KB|MB)・タップして開く/,
    )

    // 署名トークンが既存の getOrCreateShareToken 経由で発行されている。
    const tokens = await db.select().from(attachmentShareTokens)
    expect(tokens).toHaveLength(2)

    expect(await readGuidelinesSentAt(seed.broadcastId)).not.toBeNull()
  })

  it('送信直前に binding が変わっていたら push せず skipped（連携解除・再発行との競合防止）', async () => {
    const seed = await seedLinkedBroadcast()
    await addSelectedAttachment(seed, '要項.pdf')
    // 送信開始前に revoke 相当へ遷移させる（linked でなくなる）。
    await db
      .update(eventLineBroadcasts)
      .set({ status: 'revoked', lineGroupId: null })
      .where(eq(eventLineBroadcasts.id, seed.broadcastId))
    const fetchImpl = okFetch()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0 },
    )

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('binding_changed')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await readGuidelinesSentAt(seed.broadcastId)).toBeNull()
  })

  it('選択添付が0件なら skipped で何もしない（push しない・guidelines_sent_at は NULL）', async () => {
    const seed = await seedLinkedBroadcast()
    const fetchImpl = okFetch()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0 },
    )

    expect(result.status).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await readGuidelinesSentAt(seed.broadcastId)).toBeNull()
  })

  it('LINE_NOTIFY_DRY_RUN=1 のとき実 push を行わない', async () => {
    process.env.LINE_NOTIFY_DRY_RUN = '1'
    const seed = await seedLinkedBroadcast()
    await addSelectedAttachment(seed, '要項.pdf')
    const fetchImpl = okFetch()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0 },
    )

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.status).toBe('sent')
  })

  it('push 失敗時に throw せず warn し、guidelines_sent_at を更新しない', async () => {
    const seed = await seedLinkedBroadcast()
    await addSelectedAttachment(seed, '要項.pdf')
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: async () => 'server error',
        }) as unknown as Response,
    )
    const warn = vi.fn()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0, logger: { info: vi.fn(), warn } },
    )

    expect(result.status).toBe('failed')
    expect(warn).toHaveBeenCalled()
    expect(await readGuidelinesSentAt(seed.broadcastId)).toBeNull()
  })

  it('5 通を超える選択はバッチ分割して送信する', async () => {
    const seed = await seedLinkedBroadcast()
    for (let i = 1; i <= 6; i++) {
      await addSelectedAttachment(seed, `file-${i}.pdf`)
    }
    const fetchImpl = okFetch()

    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: seed.broadcastId,
        lineGroupId: seed.lineGroupId,
        channelAccessToken: seed.channelAccessToken,
      },
      { fetchImpl, batchSleepMs: 0 },
    )

    expect(result.status).toBe('sent')
    expect(result.sentCount).toBe(6)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstBatch = JSON.parse(
      String(fetchImpl.mock.calls[0]![1]!.body),
    )
    const secondBatch = JSON.parse(
      String(fetchImpl.mock.calls[1]![1]!.body),
    )
    expect(firstBatch.messages).toHaveLength(5)
    expect(secondBatch.messages).toHaveLength(1)
  })
})
