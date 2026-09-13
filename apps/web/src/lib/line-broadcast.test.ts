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
import { createEntryGroup } from '@/test-utils/seed'
import { broadcastMailToEvent } from './line-broadcast'
import { buildMailBodyFlexMessage } from '@/lib/line-flex-mail-body'
import {
  attachmentShareTokens,
  clubLineGroups,
  entryGroups,
  eventBroadcastMessages,
  eventGradeBroadcasts,
  eventLineBroadcasts,
  events,
  lineChannels,
  lineGradeGroupBindings,
  mailAttachments,
  mailBodyShareTokens,
  mailMessages,
  tournamentDrafts,
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  users,
} from '@kagetra/shared/schema'
import { db } from './db'

// mail-body-as-image: 本文カードの生成は buildMailBodyFlexMessage
// (line-flex-mail-body.ts) が担う純関数で、環境依存 (libreoffice 等) を
// 一切持たない。real 実装をそのまま通しつつ呼び出し引数だけを検証したい
// テスト (件名・訂正フラグの受け渡し) のために、実装を包んだ spy にする
// (過剰にモックしない = importOriginal で本体を維持する)。
vi.mock('@/lib/line-flex-mail-body', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/line-flex-mail-body')>()
  return {
    ...actual,
    buildMailBodyFlexMessage: vi.fn(actual.buildMailBodyFlexMessage),
  }
})

const buildMailBodyFlexMock = vi.mocked(buildMailBodyFlexMessage)

async function resetDb() {
  await db.delete(eventBroadcastMessages)
  await db.delete(attachmentShareTokens)
  await db.delete(eventLineBroadcasts)
  // entry-groups: このファイルは truncateAll ではなく自前の削除リストを持っている。
  // line_grade_group_bindings と event_grade_broadcasts は line_channels / events を
  // 参照しているので、**それらより先に**消さないと FK 違反で落ちる（前のテストファイルが
  // 残した行に引っかかる。実行順が変わったときだけ露出する脆さだった）。
  await db.delete(lineGradeGroupBindings)
  await db.delete(eventGradeBroadcasts)
  // club_line_groups.line_channel_id は RESTRICT なので line_channels より先に消す
  // （先行テストファイルが残した行に引っかかる。line-webhook-handler.test.ts と同じ形）。
  await db.delete(clubLineGroups)
  await db.delete(lineChannels)
  // entry-groups: 名簿は entry_groups を **RESTRICT** で参照する（旧: events を cascade）。
  // events を消してもグループには追従しないので、entry_groups の前に明示的に消さないと
  // 他ファイルが残した名簿行で FK 違反になる（CI の並行実行で実際に落ちた）。
  await db.delete(tournamentEntryRosterEntries)
  await db.delete(tournamentEntryRosters)
  await db.delete(tournamentDrafts)
  // mail_body_share_tokens は mail_messages を ON DELETE CASCADE で参照するので
  // 下の mailMessages 削除で自動的に消えるが、明示しておく（他テーブルと同じ様式）。
  await db.delete(mailBodyShareTokens)
  await db.delete(mailAttachments)
  await db.delete(mailMessages)
  await db.delete(events)
  await db.delete(entryGroups)
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

  const entryGroupId = (await createEntryGroup()).id
  const eventInsert = await db
    .insert(events)
    .values({ entryGroupId, title: 'テスト大会', eventDate: '2026-06-01' })
    .returning({ id: events.id })
  const eventId = eventInsert[0]!.id

  await db
    .update(lineChannels)
    .set({ assignedEntryGroupId: entryGroupId })
    .where(eq(lineChannels.id, channel.id))

  const broadcastInsert = await db
    .insert(eventLineBroadcasts)
    .values({
      entryGroupId,
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

/** fetch をモックして、実際に push された LINE メッセージ列を捕捉するヘルパー。 */
async function withCapturedPush<T>(
  run: () => Promise<T>,
): Promise<{
  result: T
  sentMessages: Array<{
    type: string
    text?: string
    altText?: string
    contents?: unknown
  }>
}> {
  const prevDryRun = process.env.LINE_NOTIFY_DRY_RUN
  delete process.env.LINE_NOTIFY_DRY_RUN
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }))
  try {
    const result = await run()
    const sentMessages = fetchSpy.mock.calls.flatMap(([, init]) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{
          type: string
          text?: string
          altText?: string
          contents?: unknown
        }>
      }
      return body.messages
    })
    return { result, sentMessages }
  } finally {
    fetchSpy.mockRestore()
    if (prevDryRun != null) process.env.LINE_NOTIFY_DRY_RUN = prevDryRun
  }
}

describe('broadcastMailToEvent', () => {
  beforeEach(async () => {
    await resetDb()
    buildMailBodyFlexMock.mockClear()
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
    const entryGroupId = (await createEntryGroup()).id
    const eventInsert = await db
      .insert(events)
      .values({ entryGroupId, title: 'no-binding', eventDate: '2026-06-01' })
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
      entryGroupId,
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

  it('AC-1: sends the mail body as a single Flex card (no image messages) for an attachment-less mail', async () => {
    const fx = await buildLinkedFixture()
    const { result, sentMessages } = await withCapturedPush(() =>
      broadcastMailToEvent(db, {
        eventId: fx.eventId,
        mailMessageId: fx.mailMessageId,
        isCorrection: false,
      }),
    )
    expect(result.status).toBe('sent')
    // 本文カード 1 通が sentTextCount にカウントされ、image message は 0。
    expect(result.sentTextCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages.filter((m) => m.type === 'image')).toHaveLength(0)
    expect(sentMessages[0]?.type).toBe('flex')

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.status).toBe('sent')
    expect(row?.isCorrection).toBe(false)
    expect(row?.sentAt).not.toBeNull()
  })

  it('AC-8: PUBLIC_BASE_URL 未設定では監査行が failed になり、push も一切起きない', async () => {
    const fx = await buildLinkedFixture()
    const prevBaseUrl = process.env.PUBLIC_BASE_URL
    const prevDryRun = process.env.LINE_NOTIFY_DRY_RUN
    delete process.env.PUBLIC_BASE_URL
    delete process.env.LINE_NOTIFY_DRY_RUN
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      const result = await broadcastMailToEvent(db, {
        eventId: fx.eventId,
        mailMessageId: fx.mailMessageId,
        isCorrection: false,
      })
      expect(result.status).toBe('failed')
      // 本文カードは try/catch で包まない (AC-8) ので、token 発行より前の
      // baseUrl 検証で throw → push 自体に到達しない。テキストへのフォール
      // バックも起きない。
      expect(fetchSpy).not.toHaveBeenCalled()

      const row = await db.query.eventBroadcastMessages.findFirst({
        where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
      })
      expect(row?.status).toBe('failed')
      expect(row?.errorMessage).toContain('PUBLIC_BASE_URL')
    } finally {
      fetchSpy.mockRestore()
      if (prevBaseUrl != null) process.env.PUBLIC_BASE_URL = prevBaseUrl
      if (prevDryRun != null) process.env.LINE_NOTIFY_DRY_RUN = prevDryRun
    }
  })

  it('AC-9: re-broadcasting the same mail reuses the same mail_body_share_tokens row (token unchanged)', async () => {
    const fx = await buildLinkedFixture()
    await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    const firstTokens = await db
      .select()
      .from(mailBodyShareTokens)
      .where(eq(mailBodyShareTokens.mailMessageId, fx.mailMessageId))
    expect(firstTokens).toHaveLength(1)

    // 2 回目: force=true で status='sent' の早期 skip を避けて実再送させる。
    await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      force: true,
    })
    const secondTokens = await db
      .select()
      .from(mailBodyShareTokens)
      .where(eq(mailBodyShareTokens.mailMessageId, fx.mailMessageId))
    expect(secondTokens).toHaveLength(1)
    expect(secondTokens[0]?.token).toBe(firstTokens[0]?.token)
  })

  it('AC-22: sends every attachment as a fallback link (no image rendering); body counts as text, attachment as fallback link', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'shiori.pdf', 'application/pdf')

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    // 本文カード 1 (sentTextCount) + 添付リンク 1 (fallbackLinkCount)。
    // sentImageCount は mail-body-as-image 以降つねに 0。
    expect(result.sentTextCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentImageCount).toBe(0)

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

  it('passes subject + correction flag through to the body card', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: true,
    })
    expect(result.status).toBe('sent')
    // 訂正フラグ・件名・公開 URL が buildMailBodyFlexMessage に渡る
    // (カードの見出し・タップ先を組み立てる素材になる)。
    expect(buildMailBodyFlexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '〇〇杯 大会案内',
        isCorrection: true,
        url: expect.stringContaining('/mail-share/'),
      }),
    )

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.isCorrection).toBe(true)
  })

  // --- 冒頭メッセージ (lead text, broadcast-lead-message) ---

  it('saves leadText and counts it as sent_lead_count=1', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      leadText: '組合せ（対戦表）が出ました！',
    })
    expect(result.status).toBe('sent')
    expect(result.sentLeadCount).toBe(1)
    // 本文カードはそのまま配信される。
    expect(result.sentTextCount).toBe(1)

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    expect(row?.leadText).toBe('組合せ（対戦表）が出ました！')
    expect(row?.sentLeadCount).toBe(1)
  })

  it('adds no lead message when leadText is empty or whitespace-only', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      leadText: '   ',
    })
    expect(result.status).toBe('sent')
    expect(result.sentLeadCount).toBe(0)
    expect(result.sentTextCount).toBe(1)

    const row = await db.query.eventBroadcastMessages.findFirst({
      where: eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId),
    })
    // trim 後空なので保存もしない (従来挙動を完全維持)。
    expect(row?.leadText).toBeNull()
    expect(row?.sentLeadCount).toBe(0)
  })

  it('prepends leadText and sends in lead → body card → attachment link order', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'shiori.pdf', 'application/pdf')

    const { result, sentMessages } = await withCapturedPush(() =>
      broadcastMailToEvent(db, {
        eventId: fx.eventId,
        mailMessageId: fx.mailMessageId,
        isCorrection: false,
        leadText: '抽選結果が出ました！',
      }),
    )
    expect(result.status).toBe('sent')
    expect(result.sentLeadCount).toBe(1)
    expect(result.sentTextCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentImageCount).toBe(0)

    expect(sentMessages).toHaveLength(3)
    // 先頭は冒頭テキスト、続いて本文カード、最後に添付カード (どちらも flex)。
    expect(sentMessages[0]).toEqual({ type: 'text', text: '抽選結果が出ました！' })
    expect(sentMessages[1]?.type).toBe('flex')
    expect(sentMessages[1]?.altText).toBe('📧 〇〇杯 大会案内')
    const bodyJson = JSON.stringify(sentMessages[1]?.contents)
    expect(bodyJson).toContain('/mail-share/')
    expect(sentMessages[2]?.type).toBe('flex')
    expect(sentMessages[2]?.altText).toBe('📎 shiori.pdf')
    // 生 URL はカードのタップアクションに隠れ、テキストとしては露出しない。
    const attachmentJson = JSON.stringify(sentMessages[2]?.contents)
    expect(attachmentJson).toContain('/api/line-broadcast/attachments/')
    expect(attachmentJson).toContain('shiori.pdf')
  })

  it('sends lead + body card even when the mail subject/body are empty (card is always sent when includeBody=true)', async () => {
    const fx = await buildLinkedFixture()
    // 件名・本文を空にしても、本文カードは「(件名なし)」等の表記で必ず送る
    // 仕様 (要件 §2.5)。旧: 本文画像 0 ページ → text fallback も空 → 本文
    // メッセージ 0 件という経路自体がもう存在しない。
    await db
      .update(mailMessages)
      .set({ subject: '', bodyText: '' })
      .where(eq(mailMessages.id, fx.mailMessageId))

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      leadText: 'タイムテーブル・進行のご案内',
    })
    expect(result.status).toBe('sent')
    expect(result.sentLeadCount).toBe(1)
    // リード文 + 本文カードの 2 通。添付・画像は 0。
    expect(result.sentTextCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)
  })

  // ───────────────────────────────────────────────────────────────────────
  // mail-inbox-mailer 2026-08-02 改修: 本文添付フラグ (AC-16 / AC-17 / AC-30)
  // ───────────────────────────────────────────────────────────────────────

  it('AC-16: includeBody=false では本文カードを送らず、lead と添付リンクだけを送る', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'meibo.xlsx', 'application/vnd.ms-excel')

    const { result, sentMessages } = await withCapturedPush(() =>
      broadcastMailToEvent(db, {
        eventId: fx.eventId,
        mailMessageId: fx.mailMessageId,
        isCorrection: false,
        leadText: '確定名簿が出ました！',
        includeBody: false,
      }),
    )
    expect(result.status).toBe('sent')
    expect(result.sentLeadCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(result.sentTextCount).toBe(0)

    // 本文カード発行 (mail_body_share_tokens の token 発行) そのものを
    // 起動しない（コストを払わない）。
    const tokens = await db
      .select()
      .from(mailBodyShareTokens)
      .where(eq(mailBodyShareTokens.mailMessageId, fx.mailMessageId))
    expect(tokens).toHaveLength(0)

    expect(sentMessages).toHaveLength(2)
    expect(sentMessages[0]).toEqual({ type: 'text', text: '確定名簿が出ました！' })
    expect(sentMessages[1]?.type).toBe('flex')
    expect(sentMessages[1]?.altText).toBe('📎 meibo.xlsx')
    expect(JSON.stringify(sentMessages[1]?.contents)).toContain(
      '/api/line-broadcast/attachments/',
    )

    const audit = await db
      .select({ includeBody: eventBroadcastMessages.includeBody })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(audit[0]?.includeBody).toBe(false)
  })

  it('AC-15/AC-30: includeBody 未指定は true 扱いで、監査行にも true が保存される', async () => {
    const fx = await buildLinkedFixture()
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
    })
    expect(result.status).toBe('sent')
    expect(result.sentTextCount).toBe(1)

    const audit = await db
      .select({ includeBody: eventBroadcastMessages.includeBody })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(audit[0]?.includeBody).toBe(true)
  })

  it('★AC-17 回帰: partial + include_body=true の行への !force 再送は、args.includeBody=false でも保存値で列を組み直す', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'kumiawase.pdf', 'application/pdf')

    // 初回に [lead, 本文カード, 添付リンク] の 3 通で組み、lead 1 通だけ届いた
    // ところで落ちた partial 行を再現する。
    await db.insert(eventBroadcastMessages).values({
      eventLineBroadcastId: fx.broadcastId,
      mailMessageId: fx.mailMessageId,
      status: 'partial',
      isCorrection: false,
      leadText: '組合せ表です',
      includeBody: true,
      sentLeadCount: 1,
      sentTextCount: 0,
      sentImageCount: 0,
      fallbackLinkCount: 0,
      errorMessage: 'boom',
    })

    // 呼び出し側が誤って（あるいは UI の既定が変わって）includeBody=false を
    // 渡しても、prefix-skip が効く経路では保存値 true が勝つ。false が勝つと
    // 列が [lead, 添付リンク] になり、skipCount=1 の読み飛ばしで添付リンクだけ
    // 送られて**本文が永久に欠落**する。
    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      leadText: '組合せ表です',
      includeBody: false,
    })

    expect(result.status).toBe('sent')
    // 初回と同じ列 [lead, 本文カード, 添付リンク] を組み直し、先頭 1 通
    // （配信済みの lead）を読み飛ばして残り 2 通を送った累計。
    expect(result.sentLeadCount).toBe(1)
    expect(result.sentTextCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentImageCount).toBe(0)

    // 保存値も true のまま（args で上書きしない）。次の再送も同じ列で走る。
    const audit = await db
      .select({ includeBody: eventBroadcastMessages.includeBody })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(audit[0]?.includeBody).toBe(true)
  })

  it('★AC-21: 旧形式で sent_image_count > 0 の partial 監査行を再送すると、prefix-skip をやめて全件再送になる', async () => {
    const fx = await buildLinkedFixture()
    await addAttachment(fx.mailMessageId, 'youkou.pdf', 'application/pdf')

    // mail-body-as-image 以前の画像配信形式で、本文画像 1 ページだけ届いて
    // 添付リンクが未送信のまま落ちた partial 行を再現する。
    await db.insert(eventBroadcastMessages).values({
      eventLineBroadcastId: fx.broadcastId,
      mailMessageId: fx.mailMessageId,
      status: 'partial',
      isCorrection: false,
      includeBody: true,
      sentLeadCount: 0,
      sentTextCount: 0,
      sentImageCount: 1,
      fallbackLinkCount: 0,
      errorMessage: 'boom',
    })

    const { result, sentMessages } = await withCapturedPush(() =>
      broadcastMailToEvent(db, {
        eventId: fx.eventId,
        mailMessageId: fx.mailMessageId,
        isCorrection: false,
      }),
    )
    expect(result.status).toBe('sent')
    // prefix-skip されず、本文カード + 添付リンクの 2 通とも送られる
    // (旧形式の sent_image_count=1 だけを見て「本文は届いた」と誤認しない)。
    expect(result.sentTextCount).toBe(1)
    expect(result.fallbackLinkCount).toBe(1)
    expect(result.sentImageCount).toBe(0)
    expect(sentMessages).toHaveLength(2)
  })

  it('AC-16: 本文 OFF・lead 無し・添付無しは skipped を返し sent にしない（監査行も sending のまま残さない）', async () => {
    const fx = await buildLinkedFixture()

    const result = await broadcastMailToEvent(db, {
      eventId: fx.eventId,
      mailMessageId: fx.mailMessageId,
      isCorrection: false,
      includeBody: false,
    })

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('empty_message_set')
    expect(result.sentLeadCount).toBe(0)
    expect(result.sentTextCount).toBe(0)
    expect(result.sentImageCount).toBe(0)
    expect(result.fallbackLinkCount).toBe(0)

    // CAS upsert で sending にした行を terminal へ落として返している
    // （落とさないと 15 分の stale reclaim まで行がロックされたままになる）。
    const audit = await db
      .select({
        status: eventBroadcastMessages.status,
        errorMessage: eventBroadcastMessages.errorMessage,
        sentAt: eventBroadcastMessages.sentAt,
      })
      .from(eventBroadcastMessages)
      .where(eq(eventBroadcastMessages.mailMessageId, fx.mailMessageId))
    expect(audit[0]?.status).not.toBe('sending')
    expect(audit[0]?.status).not.toBe('sent')
    expect(audit[0]?.errorMessage).toBe('empty_message_set')
    expect(audit[0]?.sentAt).toBeNull()
  })
})
