import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { broadcastMailToEvent } from './line-broadcast'
import {
  attachmentShareTokens,
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  lineChannels,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import { db } from './db'

async function resetDb() {
  await db.delete(eventBroadcastMessages)
  await db.delete(attachmentShareTokens)
  await db.delete(eventLineBroadcasts)
  await db.delete(lineChannels)
  await db.delete(tournamentDrafts)
  await db.delete(mailAttachments)
  await db.delete(mailMessages)
  await db.delete(events)
  await db.delete(users)
}

let originalDryRun: string | undefined
let originalBaseUrl: string | undefined

beforeAll(() => {
  originalDryRun = process.env.LINE_NOTIFY_DRY_RUN
  process.env.LINE_NOTIFY_DRY_RUN = '1'
  // r-final-15: resolveBaseUrl は PUBLIC_BASE_URL が必須なのでテスト
  // 時にダミーをセット。実際の push は LINE_NOTIFY_DRY_RUN=1 で skip。
  originalBaseUrl = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://test.example.com'
})

afterAll(() => {
  if (originalDryRun == null) {
    delete process.env.LINE_NOTIFY_DRY_RUN
  } else {
    process.env.LINE_NOTIFY_DRY_RUN = originalDryRun
  }
  if (originalBaseUrl == null) {
    delete process.env.PUBLIC_BASE_URL
  } else {
    process.env.PUBLIC_BASE_URL = originalBaseUrl
  }
})

interface Fixtures {
  eventId: number
  channelId: number
  broadcastId: number
  mailMessageId: number
}

async function buildLinkedFixture(): Promise<Fixtures> {
  const channelInsert = await db
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: '@kagetra-event-bot-test',
      purpose: 'event_broadcast',
      status: 'active',
    })
    .returning()
  const channel = channelInsert[0]!

  const eventInsert = await db
    .insert(events)
    .values({ title: 'テスト大会', eventDate: '2026-06-01' })
    .returning({ id: events.id })
  const eventId = eventInsert[0]!.id

  await db
    .update(lineChannels)
    .set({ assignedEventId: eventId })
    .where(eq(lineChannels.id, channel.id))

  const broadcastInsert = await db
    .insert(eventLineBroadcasts)
    .values({
      eventId,
      lineChannelId: channel.id,
      status: 'linked',
      lineGroupId: 'C123456789',
      linkedAt: new Date(),
    })
    .returning({ id: eventLineBroadcasts.id })
  const broadcastId = broadcastInsert[0]!.id

  const mailInsert = await db
    .insert(mailMessages)
    .values({
      messageId: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: 'organiser@example.com',
      toAddresses: ['admin@kagetra'],
      subject: '〇〇杯 大会案内',
      receivedAt: new Date(),
      bodyText: '大会案内本文 本文 本文。',
      status: 'ai_done',
    })
    .returning({ id: mailMessages.id })
  const mailMessageId = mailInsert[0]!.id

  return { eventId, channelId: channel.id, broadcastId, mailMessageId }
}

describe('broadcastMailToEvent', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('returns skipped when there is no linked binding', async () => {
    // Create everything except a linked broadcast row.
    const channelInsert = await db
      .insert(lineChannels)
      .values({
        channelId: 'ch-test-no-binding',
        channelSecret: 'secret',
        channelAccessToken: 'token',
        botId: '@b',
        purpose: 'event_broadcast',
        status: 'assigned',
      })
      .returning()
    const eventInsert = await db
      .insert(events)
      .values({ title: 'no-binding', eventDate: '2026-06-01' })
      .returning({ id: events.id })
    const eventId = eventInsert[0]!.id
    const mailInsert = await db
      .insert(mailMessages)
      .values({
        messageId: 'm-no-binding',
        fromAddress: 'a@b',
        toAddresses: ['x'],
        receivedAt: new Date(),
        bodyText: 'x',
        status: 'ai_done',
      })
      .returning({ id: mailMessages.id })
    await db.insert(eventLineBroadcasts).values({
      eventId,
      lineChannelId: channelInsert[0]!.id,
      status: 'invite_pending',
    })

    const result = await broadcastMailToEvent(db, {
      eventId,
      mailMessageId: mailInsert[0]!.id,
      isCorrection: false,
    })
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('no_active_binding')
  })

  it('marks broadcast row sent for an attachment-less mail', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    expect(result.sentTextCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.status).toBe('sent')
    expect(row?.isCorrection).toBe(false)
    expect(row?.sentAt).not.toBeNull()
  })

  it('does not create duplicate rows on retry', async () => {
    const fx = await buildLinkedFixture()
    await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    const rows = await db
      .select({ id: eventBroadcastMessages.id })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(rows).toHaveLength(1)
  })

  it('skips re-broadcasting a mail that already finished as sent', async () => {
    const fx = await buildLinkedFixture()
    // 1 回目: 正常配信 → status='sent'
    const first = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(first.status).toBe('sent')

    // 2 回目: 同じ mail を再度ブロードキャストしても、status='sent' の
    // 行があるので skipped を返して重複配信を防ぐ。
    const second = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(second.status).toBe('skipped')
    expect(second.reason).toBe('already_sent')

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.status).toBe('sent')
  })

  it('re-sends a sent mail when force=true (manualBroadcast)', async () => {
    const fx = await buildLinkedFixture()
    // 1 回目: 正常配信 → status='sent'
    const first = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(first.status).toBe('sent')

    // 2 回目: force=true で sent な mail も再配信 (manualBroadcast の UI
    // 経路)。skip ではなく sent を返し、sent_at が更新される。
    const second = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      force: true,
    })
    expect(second.status).toBe('sent')

    // audit 行は依然として 1 つだけ (重複行は作られない)。
    const rows = await db
      .select({ id: eventBroadcastMessages.id })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(rows).toHaveLength(1)
  })

  it('prefixes correction-mails with 【訂正】 + subject', async () => {
    const fx = await buildLinkedFixture()
    // Sanity: capture the mail subject so we can compare it back.
    const mail = await db.query.mailMessages.findFirst({
      where: eq(mailMessages.id, fx.mailMessageId),
    })
    expect(mail?.subject).toBe('〇〇杯 大会案内')

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: true,
    })
    expect(result.status).toBe('sent')
    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.isCorrection).toBe(true)
  })
})
