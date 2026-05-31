import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest'
import { eq } from 'drizzle-orm'
import { broadcastMailToEvent } from './line-broadcast'
import { renderBodyImageToJpegs } from '@/lib/mail-body-image-render'
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

// 本文画像化 (libreoffice spawn) はこのユニットテストの対象外。配信
// オーケストレーション (本文 image / 添付 link / text fallback の role 別
// カウント) を環境非依存で検証するため、renderBodyImageToJpegs をモジュール
// レベルでモックする。実際の libreoffice 描画は mail-body-image-render.test.ts
// の統合テストが (libreoffice 搭載環境でのみ) カバーする。
vi.mock('@/lib/mail-body-image-render', () => ({
  renderBodyImageToJpegs: vi.fn(),
}))

const renderBodyImageMock = vi.mocked(renderBodyImageToJpegs)

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
// 本文画像化の成功ケースで使う有効な JPEG。buildBodyImageMessages は sharp で
// リサイズするので、実バイト列でないと happy path を通らない。
let jpegFixture: Buffer

beforeAll(async () => {
  originalDryRun = process.env.LINE_NOTIFY_DRY_RUN
  process.env.LINE_NOTIFY_DRY_RUN = '1'
  // r-final-15: resolveBaseUrl は PUBLIC_BASE_URL が必須なのでテスト
  // 時にダミーをセット。実際の push は LINE_NOTIFY_DRY_RUN=1 で skip。
  originalBaseUrl = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://test.example.com'

  const { default: sharp } = await import('sharp')
  jpegFixture = await sharp({
    create: {
      width: 120,
      height: 160,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .jpeg()
    .toBuffer()
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

async function addAttachment(
  mailMessageId: number,
  filename: string,
  contentType: string,
): Promise<number> {
  const data = Buffer.from('fake-attachment-bytes')
  const inserted = await db
    .insert(mailAttachments)
    .values({
      mailMessageId,
      filename,
      contentType,
      sizeBytes: data.length,
      data,
    })
    .returning({ id: mailAttachments.id })
  return inserted[0]!.id
}

describe('broadcastMailToEvent', () => {
  beforeEach(async () => {
    await resetDb()
    // 既定は本文画像化成功 (1 ページ)。各テストで Once override する。
    renderBodyImageMock.mockReset()
    renderBodyImageMock.mockResolvedValue({ pages: [jpegFixture], truncated: false })
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

  it('renders the mail body as image messages for an attachment-less mail', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    // 本文 1 ページが image として配信され、text / link は 0。
    expect(result.sentImageCount).toBe(1)
    expect(result.sentTextCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)
    expect(renderBodyImageMock).toHaveBeenCalledTimes(1)

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.status).toBe('sent')
    expect(row?.isCorrection).toBe(false)
    expect(row?.sentAt).not.toBeNull()
  })

  it('falls back to text messages when body image rendering fails', async () => {
    const fx = await buildLinkedFixture()
    renderBodyImageMock.mockRejectedValueOnce(new Error('libreoffice crashed'))

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    // 画像化失敗 → buildBroadcastBody + splitForLine の text に降格。
    expect(result.sentTextCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)
  })

  it('falls back to text messages when the body exceeds the render page limit', async () => {
    const fx = await buildLinkedFixture()
    renderBodyImageMock.mockResolvedValueOnce({
      pages: [jpegFixture, jpegFixture],
      truncated: true,
    })

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    expect(result.sentTextCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
  })

  it('sends every attachment as a fallback link (no image rendering)', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'shiori.pdf', 'application/pdf')

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    // 本文画像 1 + 添付リンク 1。添付は形式問わず image にはならない。
    expect(result.sentImageCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentTextCount).toBe(0)

    // 添付の署名 URL token が 1 件発行されている。
    const tokens = await db.select().from(attachmentShareTokens)
    expect(tokens).toHaveLength(1)
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

  it('passes subject + correction flag through to the body image renderer', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: true,
    })
    expect(result.status).toBe('sent')
    // 訂正フラグ・件名・本文が renderBodyImageToJpegs に渡る (画像ヘッダーで
    // 【訂正】【件名】を描画する素材になる)。
    expect(renderBodyImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '〇〇杯 大会案内',
        rawBody: '大会案内本文 本文 本文。',
        isCorrection: true,
      }),
    )

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.isCorrection).toBe(true)
  })
})
