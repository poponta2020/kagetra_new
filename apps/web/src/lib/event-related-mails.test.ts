import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailAttachments, mailMessages } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage, createTournamentDraft } from '@/test-utils/seed'
import { loadGuidelineCandidates } from '@/lib/event-related-mails'

async function addAttachment(
  mailMessageId: number,
  filename: string,
): Promise<number> {
  const data = Buffer.from('bytes')
  const [row] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId,
      filename,
      contentType: 'application/pdf',
      sizeBytes: data.length,
      data,
    })
    .returning({ id: mailAttachments.id })
  return row!.id
}

describe('loadGuidelineCandidates', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('関連メールが無ければ空配列', async () => {
    const ev = await createEvent({ title: 'none' })
    expect(await loadGuidelineCandidates(testDb, ev.id)).toEqual([])
  })

  it('3経路unionの関連メール添付をメール別・受信日降順・添付id昇順で返し、添付無しメールは除外する', async () => {
    const ev = await createEvent({ title: 'grouped' })

    // (A) linked_event_id 経由・新しい方・添付 2 件。
    const mailA = await createMailMessage({
      subject: '案内A',
      receivedAt: new Date('2026-06-01T00:00:00Z'),
    })
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, mailA.id))
    const a1 = await addAttachment(mailA.id, 'a1.pdf')
    const a2 = await addAttachment(mailA.id, 'a2.pdf')

    // (B) tournament_drafts.event_id 経由・古い方・添付 1 件。
    const mailB = await createMailMessage({
      subject: '案内B',
      receivedAt: new Date('2026-01-01T00:00:00Z'),
    })
    await createTournamentDraft({
      messageId: mailB.id,
      status: 'approved',
      eventId: ev.id,
    })
    await addAttachment(mailB.id, 'b1.pdf')

    // (A) 経由だが添付なし → 除外される。
    const mailC = await createMailMessage({
      subject: '案内C',
      receivedAt: new Date('2026-03-01T00:00:00Z'),
    })
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, mailC.id))

    const res = await loadGuidelineCandidates(testDb, ev.id)

    // C は添付が無いので除外。A(6月) → B(1月) の受信日降順。
    expect(res.map((m) => m.subject)).toEqual(['案内A', '案内B'])
    // 添付は id 昇順（挿入順 = a1, a2）。
    expect(res[0]!.attachments.map((a) => a.id)).toEqual([a1, a2])
    expect(res[0]!.attachments.map((a) => a.filename)).toEqual([
      'a1.pdf',
      'a2.pdf',
    ])
    expect(res[0]!.attachments[0]!.contentType).toBe('application/pdf')
    expect(res[1]!.attachments.map((a) => a.filename)).toEqual(['b1.pdf'])
  })
})
