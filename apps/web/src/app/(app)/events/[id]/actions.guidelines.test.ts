import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventBroadcastGuidelineAttachments,
  eventLineBroadcasts,
  lineChannels,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

type GuidelineResult = {
  status: 'skipped' | 'sent' | 'partial' | 'failed'
  reason?: string
  sentCount: number
  totalCount: number
}

const { sendGuidelinesOnLinkMock } = vi.hoisted(() => ({
  sendGuidelinesOnLinkMock: vi.fn(
    async (): Promise<GuidelineResult> => ({
      status: 'sent',
      sentCount: 1,
      totalCount: 1,
    }),
  ),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// 実 push はテスト対象外。resendGuidelines がヘルパーを正しい引数で呼ぶことだけ
// 検証する（loadActiveBinding は実 DB を使う）。
vi.mock('@/lib/line-broadcast-guidelines', () => ({
  sendGuidelinesOnLink: sendGuidelinesOnLinkMock,
}))

const {
  generateInviteCodeForEvent,
  setGuidelineAttachments,
  resendGuidelines,
} = await import('./actions')

const ADMIN = { id: 'admin-1', role: 'admin' as const }

afterAll(async () => {
  await closeTestDb()
})

async function seedAvailableChannel(): Promise<number> {
  const [ch] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'token-xyz',
      botId: '@kagetra-event-bot-test',
      purpose: 'event_broadcast',
      status: 'available',
    })
    .returning({ id: lineChannels.id })
  return ch!.id
}

/** 関連メール（linked_event_id 経由）+ 添付を seed し、添付 id を返す。 */
async function seedRelatedAttachment(
  eventId: number,
  filename: string,
): Promise<number> {
  const mail = await createMailMessage({ subject: `案内-${filename}` })
  await testDb
    .update(mailMessages)
    .set({ linkedEventId: eventId })
    .where(eq(mailMessages.id, mail.id))
  const data = Buffer.from('bytes')
  const [att] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mail.id,
      filename,
      contentType: 'application/pdf',
      sizeBytes: data.length,
      data,
    })
    .returning({ id: mailAttachments.id })
  return att!.id
}

async function seedInvitePendingBroadcast(eventId: number): Promise<number> {
  const channelId = await seedAvailableChannel()
  const [b] = await testDb
    .insert(eventLineBroadcasts)
    .values({
      eventId,
      lineChannelId: channelId,
      status: 'invite_pending',
      inviteCode: '123456',
      inviteCodeExpiresAt: new Date(Date.now() + 60_000),
    })
    .returning({ id: eventLineBroadcasts.id })
  return b!.id
}

async function selectedIds(broadcastId: number): Promise<number[]> {
  const rows = await testDb
    .select({ id: eventBroadcastGuidelineAttachments.mailAttachmentId })
    .from(eventBroadcastGuidelineAttachments)
    .where(
      eq(
        eventBroadcastGuidelineAttachments.eventLineBroadcastId,
        broadcastId,
      ),
    )
  return rows.map((r) => r.id).sort((a, b) => a - b)
}

describe('setGuidelineAttachments', () => {
  beforeEach(async () => {
    await truncateAll()
    sendGuidelinesOnLinkMock.mockClear()
    await setAuthSession(ADMIN)
  })

  it('選択を保存し、再呼び出しで置き換える（replace 意味論）', async () => {
    const ev = await createEvent({ title: 'sel' })
    const broadcastId = await seedInvitePendingBroadcast(ev.id)
    const att1 = await seedRelatedAttachment(ev.id, 'a.pdf')
    const att2 = await seedRelatedAttachment(ev.id, 'b.pdf')

    await setGuidelineAttachments(ev.id, [att1, att2])
    expect(await selectedIds(broadcastId)).toEqual([att1, att2].sort((a, b) => a - b))

    // att2 を外す → 置き換え。
    await setGuidelineAttachments(ev.id, [att1])
    expect(await selectedIds(broadcastId)).toEqual([att1])

    // 空 → 全消し。
    await setGuidelineAttachments(ev.id, [])
    expect(await selectedIds(broadcastId)).toEqual([])
  })

  it('この大会の関連メールに無い添付は弾く', async () => {
    const ev = await createEvent({ title: 'reject' })
    await seedInvitePendingBroadcast(ev.id)
    // 別イベントの添付（この ev には無関係）。
    const other = await createEvent({ title: 'other' })
    const foreignAtt = await seedRelatedAttachment(other.id, 'x.pdf')

    await expect(setGuidelineAttachments(ev.id, [foreignAtt])).rejects.toThrow(
      /関連メールに無い添付/,
    )
  })

  it('招待コード未発行（連携行なし）なら発行を促す', async () => {
    const ev = await createEvent({ title: 'no-broadcast' })
    const att = await seedRelatedAttachment(ev.id, 'a.pdf')
    await expect(setGuidelineAttachments(ev.id, [att])).rejects.toThrow(
      /招待コードを発行/,
    )
  })

  it('紐付け完了（linked）後は選択変更を拒否する（Non-goals: linked 中は再送のみ）', async () => {
    const ev = await createEvent({ title: 'linked-reject' })
    const channelId = await seedAvailableChannel()
    await testDb.insert(eventLineBroadcasts).values({
      eventId: ev.id,
      lineChannelId: channelId,
      status: 'linked',
      lineGroupId: 'C123456789',
      linkedAt: new Date(),
    })
    const att = await seedRelatedAttachment(ev.id, 'a.pdf')
    await expect(setGuidelineAttachments(ev.id, [att])).rejects.toThrow(
      /紐付け完了後は要綱を変更できません/,
    )
  })

  it('admin / vice_admin 以外は拒否する', async () => {
    const ev = await createEvent({ title: 'auth' })
    await seedInvitePendingBroadcast(ev.id)
    const att = await seedRelatedAttachment(ev.id, 'a.pdf')

    await setAuthSession({ id: 'm', role: 'member' })
    await expect(setGuidelineAttachments(ev.id, [att])).rejects.toThrow(/Forbidden/)

    await setAuthSession(null)
    await expect(setGuidelineAttachments(ev.id, [att])).rejects.toThrow(
      /Unauthorized/,
    )
  })
})

describe('generateInviteCodeForEvent — 要綱候補と再発行時の選択保持（AC-2 / AC-8）', () => {
  beforeEach(async () => {
    await truncateAll()
    await setAuthSession(ADMIN)
  })

  it('候補を返し、再発行後も選択を保持しつつ guidelines_sent_at をリセットする', async () => {
    const ev = await createEvent({ title: 'reissue' })
    // Bot プールに 2 つ用意（再発行で別チャネルに流れても枯渇しないように）。
    await seedAvailableChannel()
    await seedAvailableChannel()
    const att = await seedRelatedAttachment(ev.id, '要項.pdf')

    // 1 回目の発行 → 候補に添付が出る。
    const first = await generateInviteCodeForEvent(ev.id)
    expect(first.guidelineCandidates.flatMap((m) => m.attachments.map((a) => a.id))).toContain(att)
    expect(first.selectedGuidelineAttachmentIds).toEqual([])

    // 選択を保存。
    await setGuidelineAttachments(ev.id, [att])

    // 送信済みを模して guidelines_sent_at を立てる。
    await testDb
      .update(eventLineBroadcasts)
      .set({ guidelinesSentAt: new Date() })
      .where(eq(eventLineBroadcasts.eventId, ev.id))

    // 2 回目の発行（再発行 = 同一行 UPDATE）。
    const second = await generateInviteCodeForEvent(ev.id)
    // 選択は保持される（AC-2）。
    expect(second.selectedGuidelineAttachmentIds).toEqual([att])

    // guidelines_sent_at はリセットされる（AC-8）。
    const row = await testDb
      .select({ guidelinesSentAt: eventLineBroadcasts.guidelinesSentAt })
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.eventId, ev.id))
      .limit(1)
    expect(row[0]!.guidelinesSentAt).toBeNull()
  })
})

describe('resendGuidelines', () => {
  beforeEach(async () => {
    await truncateAll()
    sendGuidelinesOnLinkMock.mockClear()
    sendGuidelinesOnLinkMock.mockResolvedValue({
      status: 'sent',
      sentCount: 1,
      totalCount: 1,
    })
    await setAuthSession(ADMIN)
  })

  async function seedLinkedBinding(eventId: number): Promise<number> {
    const [ch] = await testDb
      .insert(lineChannels)
      .values({
        channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        channelSecret: 'secret',
        channelAccessToken: 'token-linked',
        botId: '@kagetra-event-bot-test',
        purpose: 'event_broadcast',
        status: 'active',
        assignedEventId: eventId,
      })
      .returning({ id: lineChannels.id })
    const [b] = await testDb
      .insert(eventLineBroadcasts)
      .values({
        eventId,
        lineChannelId: ch!.id,
        status: 'linked',
        lineGroupId: 'C123456789',
        linkedAt: new Date(),
      })
      .returning({ id: eventLineBroadcasts.id })
    return b!.id
  }

  it('linked binding の情報でヘルパーを呼ぶ', async () => {
    const ev = await createEvent({ title: 'resend' })
    const broadcastId = await seedLinkedBinding(ev.id)

    await resendGuidelines(ev.id)

    expect(sendGuidelinesOnLinkMock).toHaveBeenCalledTimes(1)
    expect(sendGuidelinesOnLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventLineBroadcastId: broadcastId,
        lineGroupId: 'C123456789',
        channelAccessToken: 'token-linked',
      }),
    )
  })

  it('linked していなければエラーで返す', async () => {
    const ev = await createEvent({ title: 'not-linked' })
    await expect(resendGuidelines(ev.id)).rejects.toThrow(/LINE 連携が完了/)
    expect(sendGuidelinesOnLinkMock).not.toHaveBeenCalled()
  })

  it('送信失敗はエラーで返す', async () => {
    const ev = await createEvent({ title: 'fail' })
    await seedLinkedBinding(ev.id)
    sendGuidelinesOnLinkMock.mockResolvedValueOnce({
      status: 'failed',
      sentCount: 0,
      totalCount: 1,
    })
    await expect(resendGuidelines(ev.id)).rejects.toThrow(/送信に失敗/)
  })

  it('admin / vice_admin 以外は拒否する', async () => {
    const ev = await createEvent({ title: 'auth' })
    await seedLinkedBinding(ev.id)
    await setAuthSession({ id: 'm', role: 'member' })
    await expect(resendGuidelines(ev.id)).rejects.toThrow(/Forbidden/)
    expect(sendGuidelinesOnLinkMock).not.toHaveBeenCalled()
  })
})
