import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  mailAttachments,
  mailMessages,
  tournamentRosterImportDrafts,
  users,
} from '@kagetra/shared/schema'
import { closeDb } from '../../src/db.js'
import { runRosterParse } from '../../src/roster-import/run.js'
import { closeTestDb, testDb, truncateMailTables, truncateMailWorkerTables } from '../test-db.js'

const ADMIN_ID = 'roster-admin'

async function workbookBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const cover = workbook.addWorksheet('表紙')
  cover.addRow(['第40回大会'])
  const accepted = workbook.addWorksheet('A級当選')
  accepted.addRow(['氏名', '所属'])
  accepted.addRow(['札幌太郎', '札幌会'])
  const waitlisted = workbook.addWorksheet('A級キャンセル待ち')
  waitlisted.addRow(['氏名', '所属'])
  waitlisted.addRow(['函館花子', '函館会'])
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer)
}

async function duplicateWorkbookBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const accepted = workbook.addWorksheet('A級当選')
  accepted.addRow(['氏名'])
  accepted.addRow(['札幌 太郎'])
  const waitlisted = workbook.addWorksheet('A級キャンセル待ち')
  waitlisted.addRow(['氏名'])
  waitlisted.addRow(['札幌太郎'])
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer)
}

async function seedMail(opts: { bodyText?: string | null; subject?: string } = {}): Promise<number> {
  const [row] = await testDb.insert(mailMessages).values({
    messageId: `<roster-${crypto.randomUUID()}@example.test>`,
    fromAddress: 'sender@example.test',
    toAddresses: ['receiver@example.test'],
    subject: opts.subject ?? '第40回大会 A級 確定名簿',
    receivedAt: new Date('2024-08-01T00:00:00Z'),
    bodyText: opts.bodyText ?? null,
  }).returning({ id: mailMessages.id })
  return row!.id
}

async function seedAttachment(
  mailMessageId: number,
  opts: { filename: string; data: Buffer; extractedText?: string | null },
): Promise<number> {
  const [row] = await testDb.insert(mailAttachments).values({
    mailMessageId,
    filename: opts.filename,
    contentType: 'application/octet-stream',
    sizeBytes: opts.data.length,
    data: opts.data,
    extractedText: opts.extractedText ?? null,
    extractionStatus: opts.extractedText === undefined ? 'unsupported' : 'extracted',
  }).returning({ id: mailAttachments.id })
  return row!.id
}

describe('runRosterParse', () => {
  beforeEach(async () => {
    await truncateMailWorkerTables()
    await truncateMailTables()
    await testDb.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
    await testDb.insert(users).values({
      id: ADMIN_ID,
      name: 'Roster Admin',
      email: 'roster-admin@example.test',
      role: 'admin',
    })
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it.each(['roster.xlsx', 'roster.xlsm'])(
    'persists every roster sheet from %s and is idempotent per attachment',
    async (filename) => {
      const mailMessageId = await seedMail()
      const attachmentId = await seedAttachment(mailMessageId, {
        filename,
        data: await workbookBytes(),
      })

      const first = await runRosterParse({
        mailMessageId,
        attachmentId,
        triggeredByUserId: ADMIN_ID,
      })
      const second = await runRosterParse({
        mailMessageId,
        attachmentId,
        triggeredByUserId: ADMIN_ID,
      })

      expect(first.status).toBe('pending_review')
      expect(second.draftId).toBe(first.draftId)
      const rows = await testDb.select().from(tournamentRosterImportDrafts)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        sourceKind: 'attachment',
        sourceMailMessageId: mailMessageId,
        sourceAttachmentId: attachmentId,
        status: 'pending_review',
        inferredRosterType: 'confirmed',
        inferredGrade: 'A',
      })
      expect(rows[0]!.extractedPayload).toMatchObject({
        format: 'excel',
        sheetNames: ['A級当選', 'A級キャンセル待ち'],
      })
    },
  )

  it('persists a body-only candidate idempotently with sourceKind=body', async () => {
    const mailMessageId = await seedMail({
      bodyText: '第40回大会の確定名簿です。\nA級 札幌太郎',
    })

    const first = await runRosterParse({ mailMessageId, triggeredByUserId: ADMIN_ID })
    const second = await runRosterParse({ mailMessageId, triggeredByUserId: ADMIN_ID })

    expect(first.status).toBe('pending_review')
    expect(second.draftId).toBe(first.draftId)
    const [draft] = await testDb.select().from(tournamentRosterImportDrafts)
    expect(draft).toMatchObject({
      sourceKind: 'body',
      sourceMailMessageId: mailMessageId,
      sourceAttachmentId: null,
      status: 'pending_review',
    })
  })

  it('keeps Word text pending_review and image-only PDF parse_failed with reasons', async () => {
    const wordMailId = await seedMail()
    const wordId = await seedAttachment(wordMailId, {
      filename: '確定名簿.docx',
      data: Buffer.from('docx'),
      extractedText: 'A級 確定名簿\n札幌太郎',
    })
    const pdfMailId = await seedMail({ subject: '第40回大会 A級 名簿' })
    const pdfId = await seedAttachment(pdfMailId, {
      filename: '画像名簿.pdf',
      data: Buffer.from('%PDF-image'),
      extractedText: '',
    })

    const word = await runRosterParse({
      mailMessageId: wordMailId,
      attachmentId: wordId,
      triggeredByUserId: ADMIN_ID,
    })
    const pdf = await runRosterParse({
      mailMessageId: pdfMailId,
      attachmentId: pdfId,
      triggeredByUserId: ADMIN_ID,
    })

    expect(word.status).toBe('pending_review')
    expect(pdf.status).toBe('parse_failed')
    const [pdfDraft] = await testDb.select().from(tournamentRosterImportDrafts)
      .where(eq(tournamentRosterImportDrafts.id, pdf.draftId))
    expect(pdfDraft!.failureReason).toMatch(/画像|テキスト/)
  })

  it('isolates a corrupt Excel failure and continues with the next source', async () => {
    const badMailId = await seedMail()
    const badAttachmentId = await seedAttachment(badMailId, {
      filename: '壊れた名簿.xlsx',
      data: Buffer.from('not-an-xlsx'),
    })
    const goodMailId = await seedMail()
    const goodAttachmentId = await seedAttachment(goodMailId, {
      filename: '確定名簿.xlsx',
      data: await workbookBytes(),
    })

    const bad = await runRosterParse({
      mailMessageId: badMailId,
      attachmentId: badAttachmentId,
      triggeredByUserId: ADMIN_ID,
    })
    const good = await runRosterParse({
      mailMessageId: goodMailId,
      attachmentId: goodAttachmentId,
      triggeredByUserId: ADMIN_ID,
    })

    expect(bad.status).toBe('parse_failed')
    expect(good.status).toBe('pending_review')
    expect(await testDb.select().from(tournamentRosterImportDrafts)).toHaveLength(2)
  })

  it('keeps duplicate entries pending_review with structured validation issues', async () => {
    const mailMessageId = await seedMail()
    const attachmentId = await seedAttachment(mailMessageId, {
      filename: '重複あり確定名簿.xlsx',
      data: await duplicateWorkbookBytes(),
    })

    const result = await runRosterParse({
      mailMessageId,
      attachmentId,
      triggeredByUserId: ADMIN_ID,
    })

    expect(result.status).toBe('pending_review')
    const [draft] = await testDb.select().from(tournamentRosterImportDrafts)
      .where(eq(tournamentRosterImportDrafts.id, result.draftId))
    expect(draft!.extractedPayload).toMatchObject({
      entries: [
        expect.objectContaining({ rawName: '札幌 太郎' }),
        expect.objectContaining({ rawName: '札幌太郎' }),
      ],
      validationIssues: [
        expect.objectContaining({ code: 'duplicate_name_grade' }),
      ],
    })
  })
})
