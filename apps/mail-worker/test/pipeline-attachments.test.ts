import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailAttachments, mailMessages } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'
import { runPipelineFromFixtures } from '../src/pipeline.js'
import { closeDb } from '../src/db.js'
import {
  buildCorruptPdf,
  buildEml,
  buildMinimalDocx,
  buildMinimalPdf,
  buildMinimalXlsx,
} from './fixtures/attachments/builders.js'
import { MAX_ATTACHMENT_BYTES } from '../src/fetch/imap-client.js'

const FROM = '"主催者" <organizer@example.com>'
const TO = '"運営" <admin@example.com>'

describe('pipeline (attachments → DB)', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('persists a PDF attachment with extracted text and bytea data', async () => {
    const pdf = buildMinimalPdf('PR2 attachment body')
    const eml = buildEml({
      messageId: '<pr2-pdf-1@example.com>',
      from: FROM,
      to: TO,
      subject: '大会案内 (PDF 添付)',
      textBody: 'PDF を添付しました。',
      attachments: [{ filename: '大会要項.pdf', contentType: 'application/pdf', data: pdf }],
    })

    const summary = await runPipelineFromFixtures([{ source: eml, imapUid: 1 }])
    expect(summary.inserted).toBe(1)
    expect(summary.attachmentsInserted).toBe(1)
    expect(summary.attachmentsExtracted).toBe(1)
    expect(summary.attachmentsExtractionFailed).toBe(0)
    expect(summary.attachmentsUnsupported).toBe(0)
    expect(summary.attachmentsSkipped).toBe(0)
    expect(summary.attachmentsDbFailed).toBe(0)

    const [mail] = await testDb.select().from(mailMessages)
    expect(mail).toBeTruthy()
    const rows = await testDb
      .select()
      .from(mailAttachments)
      .where(eq(mailAttachments.mailMessageId, mail!.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.filename).toBe('大会要項.pdf')
    expect(rows[0]!.contentType).toBe('application/pdf')
    expect(rows[0]!.extractionStatus).toBe('extracted')
    expect(rows[0]!.extractedText ?? '').toContain('PR2 attachment body')
    // bytea round-trips as Buffer through pg
    expect(Buffer.isBuffer(rows[0]!.data)).toBe(true)
    expect(rows[0]!.data.equals(pdf)).toBe(true)
    expect(rows[0]!.sizeBytes).toBe(pdf.length)
  })

  it('extracts DOCX text via mammoth', async () => {
    const docx = await buildMinimalDocx('参加申込書 PR2')
    const eml = buildEml({
      messageId: '<pr2-docx-1@example.com>',
      from: FROM,
      to: TO,
      subject: '申込書 (DOCX)',
      textBody: '申込書を添付しました。',
      attachments: [
        {
          filename: '申込書.docx',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data: docx,
        },
      ],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.attachmentsInserted).toBe(1)
    expect(summary.attachmentsExtracted).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.extractedText).toBe('参加申込書 PR2')
  })

  it('extracts XLSX text via SheetJS sheet_to_csv', async () => {
    const xlsx = buildMinimalXlsx('Schedule', [
      ['Date', 'Round'],
      ['2026-05-30', 'A'],
    ])
    const eml = buildEml({
      messageId: '<pr2-xlsx-1@example.com>',
      from: FROM,
      to: TO,
      subject: '日程表 (XLSX)',
      textBody: '日程表を添付しました。',
      attachments: [
        {
          filename: '日程表.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: xlsx,
        },
      ],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.attachmentsInserted).toBe(1)
    expect(summary.attachmentsExtracted).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.extractedText).toContain('Date,Round')
    expect(rows[0]!.extractedText).toContain('2026-05-30,A')
  })

  it('persists a corrupt PDF with extraction_status=failed and keeps the binary', async () => {
    const broken = buildCorruptPdf()
    const eml = buildEml({
      messageId: '<pr2-broken-pdf@example.com>',
      from: FROM,
      to: TO,
      subject: '壊れた PDF',
      textBody: 'broken pdf',
      attachments: [{ filename: 'broken.pdf', contentType: 'application/pdf', data: broken }],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.attachmentsInserted).toBe(1)
    expect(summary.attachmentsExtracted).toBe(0)
    expect(summary.attachmentsExtractionFailed).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.extractionStatus).toBe('failed')
    expect(rows[0]!.extractedText).toBeNull()
    expect(rows[0]!.data.equals(broken)).toBe(true)
  })

  it('persists an unsupported attachment with extraction_status=unsupported', async () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const eml = buildEml({
      messageId: '<pr2-zip@example.com>',
      from: FROM,
      to: TO,
      subject: '未対応 ZIP',
      textBody: 'zip',
      attachments: [
        { filename: 'bundle.zip', contentType: 'application/zip', data: zipBytes },
      ],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.attachmentsInserted).toBe(1)
    expect(summary.attachmentsUnsupported).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.extractionStatus).toBe('unsupported')
    expect(rows[0]!.extractedText).toBeNull()
  })

  it('skips inline cid-referenced images and does NOT insert a row for them', async () => {
    // multipart/related + Content-ID + inline disposition is the canonical
    // shape mailparser tags as `related === true`.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const eml = buildEml({
      messageId: '<pr2-inline@example.com>',
      from: FROM,
      to: TO,
      subject: 'inline only',
      textBody: '本文',
      htmlBody: '<p>see <img src="cid:logo123"></p>',
      attachments: [
        { filename: 'logo.png', contentType: 'image/png', data: png, cid: 'logo123' },
      ],
      related: true,
    })
    const warn = vi.fn()
    const summary = await runPipelineFromFixtures([{ source: eml }], {
      logger: { info: () => undefined, warn },
    })
    expect(summary.attachmentsInserted).toBe(0)
    expect(summary.attachmentsSkipped).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(
      'attachment skipped',
      expect.objectContaining({ reason: 'inline_referenced' }),
    )
  })

  it('skips oversized attachments (> 30 MB) without persisting anything', async () => {
    // We don't actually allocate 31 MB of PDF — just craft a tiny eml whose
    // attachment header advertises a giant size. Real mailparser uses the
    // decoded content length, so we add an extra guard at the parser by
    // padding the buffer to just over the limit. To keep test memory low,
    // we patch MAX_ATTACHMENT_BYTES indirectly by sending a buffer one byte
    // over the cap. Allocating ~31 MB once is acceptable in CI.
    const oversize = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41)
    const eml = buildEml({
      messageId: '<pr2-oversize@example.com>',
      from: FROM,
      to: TO,
      subject: 'oversize',
      textBody: 'oversize',
      attachments: [
        { filename: 'huge.pdf', contentType: 'application/pdf', data: oversize },
      ],
    })
    const warn = vi.fn()
    const summary = await runPipelineFromFixtures([{ source: eml }], {
      logger: { info: () => undefined, warn },
    })
    expect(summary.attachmentsInserted).toBe(0)
    expect(summary.attachmentsSkipped).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      'attachment skipped',
      expect.objectContaining({ reason: 'oversized' }),
    )
  })

  it('dry-run inspects extraction outcome without writing rows', async () => {
    const pdf = buildMinimalPdf('dry run text')
    const eml = buildEml({
      messageId: '<pr2-dry-run@example.com>',
      from: FROM,
      to: TO,
      subject: 'dry-run',
      textBody: 'dry-run',
      attachments: [{ filename: 'dry.pdf', contentType: 'application/pdf', data: pdf }],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }], { dryRun: true })
    // Counters reflect what would have happened, but no inserts ran.
    expect(summary.attachmentsExtracted).toBe(1)
    expect(summary.attachmentsInserted).toBe(0)
    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(0)
  })

  it('does NOT re-insert attachments when the parent mail is a duplicate', async () => {
    const pdf = buildMinimalPdf('idempotent body')
    const eml = buildEml({
      messageId: '<pr2-dup@example.com>',
      from: FROM,
      to: TO,
      subject: 'duplicate',
      textBody: 'duplicate',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', data: pdf }],
    })
    const first = await runPipelineFromFixtures([{ source: eml }])
    expect(first.attachmentsInserted).toBe(1)

    const second = await runPipelineFromFixtures([{ source: eml }])
    expect(second.duplicated).toBe(1)
    expect(second.attachmentsInserted).toBe(0)
    // mail_attachments should still hold exactly one row.
    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(1)
  })

  it('isolates a single corrupt attachment so the other attachments still persist', async () => {
    const goodPdf = buildMinimalPdf('good')
    const broken = buildCorruptPdf()
    const goodXlsx = buildMinimalXlsx('S', [['ok']])
    const eml = buildEml({
      messageId: '<pr2-mixed@example.com>',
      from: FROM,
      to: TO,
      subject: 'mixed',
      textBody: 'mixed',
      attachments: [
        { filename: 'good.pdf', contentType: 'application/pdf', data: goodPdf },
        { filename: 'broken.pdf', contentType: 'application/pdf', data: broken },
        {
          filename: 'good.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: goodXlsx,
        },
      ],
    })
    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.attachmentsInserted).toBe(3)
    expect(summary.attachmentsExtracted).toBe(2)
    expect(summary.attachmentsExtractionFailed).toBe(1)

    const rows = await testDb.select().from(mailAttachments)
    expect(rows).toHaveLength(3)
    const byName = new Map(rows.map((r) => [r.filename, r]))
    expect(byName.get('good.pdf')!.extractionStatus).toBe('extracted')
    expect(byName.get('broken.pdf')!.extractionStatus).toBe('failed')
    expect(byName.get('good.xlsx')!.extractionStatus).toBe('extracted')
  })
})
