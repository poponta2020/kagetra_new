import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailMessages } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'
import { runPipelineFromFixtures } from '../src/pipeline.js'
import { closeDb } from '../src/db.js'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

describe('pipeline (fixture → DB)', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('inserts three fixture mails into mail_messages', async () => {
    const summary = await runPipelineFromFixtures([
      { source: await loadFixture('tournament-announcement.eml'), imapUid: 100 },
      { source: await loadFixture('newsletter-with-unsubscribe.eml'), imapUid: 101 },
      { source: await loadFixture('personal-mail.eml'), imapUid: 102 },
    ])
    expect(summary.fetched).toBe(3)
    expect(summary.inserted).toBe(3)
    expect(summary.duplicated).toBe(0)
    expect(summary.failed).toBe(0)

    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(3)
    const subjects = rows.map((r) => r.subject)
    expect(subjects).toContain('Re: Lunch next week?')
    expect(subjects).toContain('Weekly Update: New Features Available')
  })

  it('persists header-pre-filter hits with classification=noise', async () => {
    await runPipelineFromFixtures([
      { source: await loadFixture('newsletter-with-unsubscribe.eml') },
    ])
    const newsletter = await testDb
      .select()
      .from(mailMessages)
      .where(
        eq(mailMessages.messageId, '<newsletter-2026-04-13@example-newsletter.com>'),
      )
    expect(newsletter).toHaveLength(1)
    expect(newsletter[0]!.classification).toBe('noise')
  })

  it('does NOT classify regular mails as noise', async () => {
    await runPipelineFromFixtures([
      { source: await loadFixture('tournament-announcement.eml') },
      { source: await loadFixture('personal-mail.eml') },
    ])
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.classification).toBeNull()
    }
  })

  it('does NOT classify ML mailing-list announcements as noise', async () => {
    // Real taikai-ajka mails carry List-Id + Precedence: list + List-Unsubscribe.
    // The pre-filter must let these through so the AI step (PR3) can extract them.
    await runPipelineFromFixtures([
      { source: await loadFixture('ml-tournament-announcement.eml') },
    ])
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.classification).toBeNull()
    expect(rows[0]!.subject).toContain('第66回')
  })

  it('persists a mail with no Subject header (column is nullable)', async () => {
    const summary = await runPipelineFromFixtures([
      { source: await loadFixture('no-subject.eml') },
    ])
    expect(summary.fetched).toBe(1)
    expect(summary.inserted).toBe(1)
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject).toBeNull()
  })

  it('de-duplicates by Message-ID (second run is idempotent)', async () => {
    const buf = await loadFixture('personal-mail.eml')
    const first = await runPipelineFromFixtures([{ source: buf }])
    expect(first.inserted).toBe(1)
    expect(first.duplicated).toBe(0)

    const second = await runPipelineFromFixtures([{ source: buf }])
    expect(second.fetched).toBe(1)
    expect(second.inserted).toBe(0)
    expect(second.duplicated).toBe(1)

    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(1)
  })

  it('persists from address, body text, and IMAP UID', async () => {
    await runPipelineFromFixtures([
      { source: await loadFixture('personal-mail.eml'), imapUid: 999, imapBox: 'INBOX' },
    ])
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.fromAddress).toBe('friend@example.org')
    expect(row.fromName).toBe('Yamada Taro')
    expect(row.imapUid).toBe(999)
    expect(row.imapBox).toBe('INBOX')
    expect(row.bodyText).toContain('Thursday at 12:30')
    expect(row.status).toBe('fetched')
  })

  it('dry-run reports counts without writing rows', async () => {
    const summary = await runPipelineFromFixtures(
      [
        { source: await loadFixture('tournament-announcement.eml') },
        { source: await loadFixture('newsletter-with-unsubscribe.eml') },
      ],
      { dryRun: true },
    )
    expect(summary.fetched).toBe(2)
    expect(summary.noise).toBe(1)
    expect(summary.inserted).toBe(0)
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(0)
  })

  it('honours --since: skips mails older than the cutoff', async () => {
    const summary = await runPipelineFromFixtures(
      [
        { source: await loadFixture('tournament-announcement.eml') }, // 2026-04-08
        { source: await loadFixture('personal-mail.eml') }, // 2026-04-14
      ],
      { since: new Date('2026-04-12T00:00:00+09:00') },
    )
    expect(summary.fetched).toBe(1)
    expect(summary.inserted).toBe(1)
    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject).toBe('Re: Lunch next week?')
  })

  it('isolates per-mail errors: one bad insert does not abort the batch', async () => {
    // Stub insertMailMessage so the second mail throws but the others succeed.
    const persistModule = await import('../src/persist/mail-message.js')
    const realInsert = persistModule.insertMailMessage
    let callCount = 0
    const spy = vi
      .spyOn(persistModule, 'insertMailMessage')
      .mockImplementation(async (db, input) => {
        callCount += 1
        if (callCount === 2) {
          throw new Error('simulated DB failure for second mail')
        }
        return realInsert(db, input)
      })

    const warnSpy = vi.fn()
    const summary = await runPipelineFromFixtures(
      [
        { source: await loadFixture('tournament-announcement.eml') },
        { source: await loadFixture('newsletter-with-unsubscribe.eml') },
        { source: await loadFixture('personal-mail.eml') },
      ],
      { logger: { info: vi.fn(), warn: warnSpy } },
    )

    expect(summary.fetched).toBe(3)
    expect(summary.inserted).toBe(2)
    expect(summary.failed).toBe(1)

    // Logger captured the failure with the failing mail's Message-ID.
    expect(warnSpy).toHaveBeenCalledWith(
      'mail persist failed',
      expect.objectContaining({
        messageId: '<newsletter-2026-04-13@example-newsletter.com>',
        err: expect.stringContaining('simulated DB failure'),
      }),
    )

    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(2)

    spy.mockRestore()
  })
})
