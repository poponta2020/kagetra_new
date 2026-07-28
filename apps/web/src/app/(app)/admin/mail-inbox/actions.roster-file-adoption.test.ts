import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  mailAttachments,
  tournamentEntryRosterFiles,
  tournamentRosterImportDrafts,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createMailMessage,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// roster-file-adoption タスク2: actions.roster-import.test.ts と同じ最小限の
// mock preamble（`./actions` の import chain を解決するために必須）。
const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/line-broadcast', () => ({
  broadcastMailToEvent: vi.fn(),
  loadActiveBinding: vi.fn(async () => null),
}))
vi.mock('@kagetra/mail-worker/classify/classifier', () => ({
  classifyMail: vi.fn(),
  persistOutcome: vi.fn(),
}))
vi.mock('@kagetra/mail-worker/classify/llm/anthropic', () => ({
  AnthropicSonnet46Extractor: class {},
}))
vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'test' }),
}))

const { adoptRosterFile, releaseRosterFile } = await import('./actions')

async function createAttachment(mailId: number, filename = 'roster.xlsx') {
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mailId,
      filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 16,
      data: Buffer.from('test'),
      extractionStatus: 'pending',
    })
    .returning()
  return attachment!
}

async function getRosterFileByAttachment(attachmentId: number) {
  return testDb
    .select()
    .from(tournamentEntryRosterFiles)
    .where(eq(tournamentEntryRosterFiles.sourceAttachmentId, attachmentId))
}

describe('admin/mail-inbox roster-file-adoption actions', () => {
  beforeEach(async () => {
    await truncateAll()
    revalidatePathMock.mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('adoptRosterFile', () => {
    it('admin が採用すると tournament_entry_roster_files に1件作られる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: '採用先大会' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, event.id, 'applicant')
      expect(result.ok).toBe(true)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.entryGroupId).toBe(event.entryGroupId)
      expect(rows[0]?.rosterType).toBe('applicant')
      expect(rows[0]?.sourceMailMessageId).toBe(mail.id)
      expect(rows[0]?.adoptedByUserId).toBe(admin.id)
    })

    it('vice_admin も採用できる', async () => {
      const viceAdmin = await createViceAdmin()
      await setAuthSession({ id: viceAdmin.id, role: 'vice_admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, event.id, 'confirmed')
      expect(result.ok).toBe(true)
    })

    it('member は採用できない (Forbidden)', async () => {
      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      await expect(
        adoptRosterFile(attachment.id, event.id, 'applicant'),
      ).rejects.toThrow('Forbidden')
    })

    it('未認証は採用できない (Unauthorized)', async () => {
      await setAuthSession(null)
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      await expect(
        adoptRosterFile(attachment.id, event.id, 'applicant'),
      ).rejects.toThrow('Unauthorized')
    })

    it('publishedAt 省略時はメール受信日 (JST) が既定値になる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage({
        receivedAt: new Date('2030-06-15T01:00:00Z'),
      })
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, event.id, 'applicant')
      expect(result.ok).toBe(true)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows[0]?.publishedAt).toBe('2030-06-15')
    })

    it('publishedAt を指定するとその値が保存される', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(
        attachment.id,
        event.id,
        'applicant',
        '2030-07-01',
      )
      expect(result.ok).toBe(true)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows[0]?.publishedAt).toBe('2030-07-01')
    })

    it('不正な publishedAt はエラーを返し、レコードを作らない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(
        attachment.id,
        event.id,
        'applicant',
        '2030/07/01',
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/形式が不正/)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows).toHaveLength(0)
    })

    it('同一添付の二重採用はエラーを返す (AC-11)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      await adoptRosterFile(attachment.id, event.id, 'applicant')

      const result = await adoptRosterFile(attachment.id, event.id, 'confirmed')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に採用されています/)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.rosterType).toBe('applicant')
    })

    it('同一グループ×種別へ複数ファイルを採用できる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const group = await createEntryGroup()
      const event = await createEvent({ title: 'E', entryGroupId: group.id })
      const mail = await createMailMessage()
      const attachment1 = await createAttachment(mail.id, 'a.xlsx')
      const attachment2 = await createAttachment(mail.id, 'b.xlsx')

      const r1 = await adoptRosterFile(attachment1.id, event.id, 'applicant')
      const r2 = await adoptRosterFile(attachment2.id, event.id, 'applicant')
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)

      const rows = await testDb
        .select()
        .from(tournamentEntryRosterFiles)
        .where(eq(tournamentEntryRosterFiles.entryGroupId, group.id))
      expect(rows).toHaveLength(2)
    })

    it('validateLinkableEvent 違反: cancelled イベントには採用できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E', status: 'cancelled' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, event.id, 'applicant')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/キャンセル済み/)

      const rows = await getRosterFileByAttachment(attachment.id)
      expect(rows).toHaveLength(0)
    })

    it('validateLinkableEvent 違反: 過去 31 日より古いイベントには採用できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const old = new Date(Date.now() - 60 * 24 * 3600 * 1000)
      const oldStr = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`
      const event = await createEvent({ title: 'E', status: 'done', eventDate: oldStr })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, event.id, 'applicant')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/過去 30 日/)
    })

    it('存在しない添付はエラーを返す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })

      const result = await adoptRosterFile(999_999, event.id, 'applicant')
      expect(result.ok).toBe(false)
    })

    it('存在しないイベントはエラーを返す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      const result = await adoptRosterFile(attachment.id, 999_999, 'applicant')
      expect(result.ok).toBe(false)
    })

    it('同一添付に pending_review な roster import draft があっても採用でき、draft の状態は変えない（既存ドラフトから独立）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      const [draft] = await testDb
        .insert(tournamentRosterImportDrafts)
        .values({
          sourceKind: 'attachment',
          sourceMailMessageId: mail.id,
          sourceAttachmentId: attachment.id,
          parserVersion: 'roster-deterministic-v1',
          status: 'pending_review',
        })
        .returning()

      const result = await adoptRosterFile(attachment.id, event.id, 'applicant')
      expect(result.ok).toBe(true)

      const draftAfter = await testDb.query.tournamentRosterImportDrafts.findFirst({
        where: eq(tournamentRosterImportDrafts.id, draft!.id),
      })
      expect(draftAfter?.status).toBe('pending_review')
    })

    it('採用は entry_group 内の全 event の /events/:id を revalidate する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const group = await createEntryGroup()
      const event1 = await createEvent({
        title: 'Day1',
        entryGroupId: group.id,
        eventDate: '2030-01-01',
      })
      const event2 = await createEvent({
        title: 'Day2',
        entryGroupId: group.id,
        eventDate: '2030-01-02',
      })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)

      await adoptRosterFile(attachment.id, event1.id, 'applicant')

      expect(revalidatePathMock).toHaveBeenCalledWith(`/events/${event1.id}`)
      expect(revalidatePathMock).toHaveBeenCalledWith(`/events/${event2.id}`)
      expect(revalidatePathMock).toHaveBeenCalledWith('/admin/mail-inbox')
      expect(revalidatePathMock).toHaveBeenCalledWith(
        `/admin/mail-inbox/mail/${mail.id}`,
      )
    })
  })

  describe('releaseRosterFile', () => {
    it('admin が解除すると行が削除され、添付そのものは残る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      await adoptRosterFile(attachment.id, event.id, 'applicant')
      const rows = await getRosterFileByAttachment(attachment.id)
      const rosterFileId = rows[0]!.id

      const result = await releaseRosterFile(rosterFileId)
      expect(result.ok).toBe(true)

      const after = await testDb.query.tournamentEntryRosterFiles.findFirst({
        where: eq(tournamentEntryRosterFiles.id, rosterFileId),
      })
      expect(after).toBeUndefined()

      const attachmentAfter = await testDb.query.mailAttachments.findFirst({
        where: eq(mailAttachments.id, attachment.id),
      })
      expect(attachmentAfter).toBeDefined()
    })

    it('vice_admin も解除できる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      await adoptRosterFile(attachment.id, event.id, 'applicant')
      const rows = await getRosterFileByAttachment(attachment.id)
      const rosterFileId = rows[0]!.id

      const viceAdmin = await createViceAdmin()
      await setAuthSession({ id: viceAdmin.id, role: 'vice_admin' })
      const result = await releaseRosterFile(rosterFileId)
      expect(result.ok).toBe(true)
    })

    it('member は解除できない (Forbidden)', async () => {
      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(releaseRosterFile(1)).rejects.toThrow('Forbidden')
    })

    it('未認証は解除できない (Unauthorized)', async () => {
      await setAuthSession(null)
      await expect(releaseRosterFile(1)).rejects.toThrow('Unauthorized')
    })

    it('解除後、同じ添付を別イベント・別種別で再採用できる（付け替え）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const event2 = await createEvent({ title: 'E2' })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      await adoptRosterFile(attachment.id, event.id, 'applicant')
      const rows = await getRosterFileByAttachment(attachment.id)
      await releaseRosterFile(rows[0]!.id)

      const result = await adoptRosterFile(attachment.id, event2.id, 'confirmed')
      expect(result.ok).toBe(true)

      const after = await getRosterFileByAttachment(attachment.id)
      expect(after).toHaveLength(1)
      expect(after[0]?.entryGroupId).toBe(event2.entryGroupId)
      expect(after[0]?.rosterType).toBe('confirmed')
    })

    it('存在しない id はエラーを返す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const result = await releaseRosterFile(999_999)
      expect(result.ok).toBe(false)
    })

    it('解除は entry_group 内の全 event の /events/:id を revalidate する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const group = await createEntryGroup()
      const event1 = await createEvent({
        title: 'Day1',
        entryGroupId: group.id,
        eventDate: '2030-01-01',
      })
      const event2 = await createEvent({
        title: 'Day2',
        entryGroupId: group.id,
        eventDate: '2030-01-02',
      })
      const mail = await createMailMessage()
      const attachment = await createAttachment(mail.id)
      await adoptRosterFile(attachment.id, event1.id, 'applicant')
      const rows = await getRosterFileByAttachment(attachment.id)
      revalidatePathMock.mockClear()

      await releaseRosterFile(rows[0]!.id)

      expect(revalidatePathMock).toHaveBeenCalledWith(`/events/${event1.id}`)
      expect(revalidatePathMock).toHaveBeenCalledWith(`/events/${event2.id}`)
    })
  })
})
