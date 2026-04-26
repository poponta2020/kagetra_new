import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailAttachments, mailMessages } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'

// Mock the attachment persister BEFORE importing pipeline so the pipeline
// picks up the mocked binding. We swap the implementation per-test below to
// simulate a DB hiccup on the attachment insert and verify the parent rolls
// back atomically.
const mockInsertAttachment = vi.fn()
vi.mock('../src/persist/attachment.js', () => ({
  insertMailAttachment: (...args: unknown[]) => mockInsertAttachment(...args),
}))

const { runPipelineFromFixtures } = await import('../src/pipeline.js')
const { closeDb } = await import('../src/db.js')
const { buildEml, buildMinimalPdf } = await import('./fixtures/attachments/builders.js')

const FROM = '"organizer" <organizer@example.com>'
const TO = '"admin" <admin@example.com>'

describe('runPipeline (transaction rollback)', () => {
  beforeEach(async () => {
    await truncateMailTables()
    mockInsertAttachment.mockReset()
  })
  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('rolls back the parent mail when an attachment insert fails', async () => {
    // Simulate a DB hiccup on attachment insert. The mail_messages row was
    // inserted moments earlier in the same txn — it must NOT survive.
    mockInsertAttachment.mockRejectedValue(new Error('simulated DB hiccup'))

    const pdf = buildMinimalPdf('rolling back')
    const eml = buildEml({
      messageId: '<pr2-rollback-1@example.com>',
      from: FROM,
      to: TO,
      subject: 'rollback test',
      textBody: 'body',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', data: pdf }],
    })

    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.failed).toBe(1)
    expect(summary.inserted).toBe(0)
    expect(summary.duplicated).toBe(0)
    expect(summary.attachmentsInserted).toBe(0)

    // Atomicity: neither parent nor attachment may persist.
    expect(await testDb.select().from(mailMessages)).toHaveLength(0)
    expect(await testDb.select().from(mailAttachments)).toHaveLength(0)
  })

  it('a subsequent successful run inserts the same Message-ID end-to-end', async () => {
    // First run: attachment insert fails → rollback → no parent row.
    mockInsertAttachment.mockRejectedValueOnce(new Error('first attempt fails'))

    const pdf = buildMinimalPdf('retry me')
    const eml = buildEml({
      messageId: '<pr2-retry@example.com>',
      from: FROM,
      to: TO,
      subject: 'retry',
      textBody: 'retry',
      attachments: [{ filename: 'retry.pdf', contentType: 'application/pdf', data: pdf }],
    })

    const first = await runPipelineFromFixtures([{ source: eml }])
    expect(first.failed).toBe(1)
    expect(await testDb.select().from(mailMessages)).toHaveLength(0)

    // Second run: pipeline retries the same Message-ID. With no orphan parent
    // left behind, dedup correctly treats this as a fresh insert and the
    // attachment lands too.
    const real = await vi.importActual<typeof import('../src/persist/attachment.js')>(
      '../src/persist/attachment.js',
    )
    mockInsertAttachment.mockImplementation(real.insertMailAttachment)

    const second = await runPipelineFromFixtures([{ source: eml }])
    expect(second.failed).toBe(0)
    expect(second.inserted).toBe(1)
    expect(second.attachmentsInserted).toBe(1)

    expect(await testDb.select().from(mailMessages)).toHaveLength(1)
    expect(await testDb.select().from(mailAttachments)).toHaveLength(1)
  })

  it('rolls back ALL siblings when the second of three attachments fails', async () => {
    // First two inserts succeed, third raises. Drizzle's BEGIN/ROLLBACK must
    // discard rows 1 and 2 too, otherwise we'd leave a partial mail behind.
    let callCount = 0
    const real = await vi.importActual<typeof import('../src/persist/attachment.js')>(
      '../src/persist/attachment.js',
    )
    mockInsertAttachment.mockImplementation(async (...args: Parameters<typeof real.insertMailAttachment>) => {
      callCount += 1
      if (callCount === 3) throw new Error('third attachment poisoned')
      return real.insertMailAttachment(...args)
    })

    const pdf = buildMinimalPdf('three sibs')
    const eml = buildEml({
      messageId: '<pr2-three-sibs@example.com>',
      from: FROM,
      to: TO,
      subject: 'three',
      textBody: 'three',
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', data: pdf },
        { filename: 'b.pdf', contentType: 'application/pdf', data: pdf },
        { filename: 'c.pdf', contentType: 'application/pdf', data: pdf },
      ],
    })

    const summary = await runPipelineFromFixtures([{ source: eml }])
    expect(summary.failed).toBe(1)
    expect(summary.inserted).toBe(0)
    expect(summary.attachmentsInserted).toBe(0)

    expect(await testDb.select().from(mailMessages)).toHaveLength(0)
    expect(await testDb.select().from(mailAttachments)).toHaveLength(0)
  })
})
