import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailMessages, tournamentRosterImportDrafts } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'
import { runPipelineFromFixtures, type PipelineSummary } from '../src/pipeline.js'
import { closeDb } from '../src/db.js'
import { buildCorruptPdf, buildEml } from './fixtures/attachments/builders.js'

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

    const second = await runPipelineFromFixtures(
      [{ source: buf }],
      { mailbox: '99_202510以前のメール' },
    )
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

  it('archive mailbox dry-run returns bounded roster candidate counts without mutation', async () => {
    const rosterMail = Buffer.from([
      'Message-ID: <archive-roster@example.test>',
      'From: organizer@example.test',
      'To: receiver@example.test',
      'Date: Thu, 1 Aug 2024 09:00:00 +0900',
      'Subject: =?UTF-8?B?56ysNDDlm57lpKfkvJogQee0miDmip3pgbjntZDmnpw=?=',
      '',
      'A級の確定名簿を送付します。',
    ].join('\r\n'))
    const summary = await runPipelineFromFixtures([{ source: rosterMail }], {
      dryRun: true,
      mailbox: '99_202510以前のメール',
      fromYear: 2024,
      toYear: 2024,
      maxRosterCandidates: 1,
      maxRosterAiCalls: 0,
    })

    expect(summary.rosterCandidateMessages).toBe(1)
    expect(summary.rosterCandidateBodies).toBe(1)
    expect(summary.rosterCandidatesSelected).toBe(1)
    expect(summary.rosterAiEligible).toBe(0)
    expect(await testDb.select().from(mailMessages)).toHaveLength(0)
  })

  it('explicit archive stage mode creates one idempotent review draft per selected source', async () => {
    const rosterMail = Buffer.from([
      'Message-ID: <archive-stage-roster@example.test>',
      'From: organizer@example.test',
      'To: receiver@example.test',
      'Date: Thu, 1 Aug 2024 09:00:00 +0900',
      'Subject: A級 確定名簿',
      '',
      'A級の確定名簿を送付します。',
    ].join('\r\n'))
    const options = {
      mailbox: '99_202510以前のメール',
      fromYear: 2024,
      toYear: 2024,
      maxRosterCandidates: 1,
      maxRosterAiCalls: 0,
      stageRosterDrafts: true,
    }

    const first = await runPipelineFromFixtures([{ source: rosterMail, imapUid: 501 }], options)
    expect(first).toMatchObject({
      inserted: 1,
      rosterCandidatesSelected: 1,
      rosterDraftsCreated: 1,
      rosterDraftsReused: 0,
      rosterDraftsFailed: 0,
      nextResumeCursor: 501,
    })

    const second = await runPipelineFromFixtures([{ source: rosterMail, imapUid: 501 }], options)
    expect(second).toMatchObject({
      duplicated: 1,
      rosterDraftsCreated: 0,
      rosterDraftsReused: 1,
      rosterDraftsFailed: 0,
    })
    expect(await testDb.select().from(tournamentRosterImportDrafts)).toHaveLength(1)
  })

  it('keeps the resume cursor before a selected source whose staged draft cannot be parsed', async () => {
    const rosterMail = buildEml({
      messageId: '<archive-stage-failure@example.test>',
      from: 'organizer@example.test',
      to: 'receiver@example.test',
      date: 'Thu, 1 Aug 2024 09:00:00 +0900',
      subject: 'A邏・遒ｺ螳壼錐邁ｿ',
      textBody: 'A邏壹・遒ｺ螳壼錐邁ｿ繧帝∽ｻ倥＠縺ｾ縺吶・',
      attachments: [{
        filename: 'A邏・遒ｺ螳壼錐邁ｿ.pdf',
        contentType: 'application/pdf',
        data: buildCorruptPdf(),
      }],
    })

    // The candidate classifier has its own exhaustive tests. Pin this test to
    // the staging failure boundary: a selected attachment whose extracted
    // text is unavailable must not let the archive cursor skip past its UID.
    const candidateModule = await import('../src/roster-import/candidate.js')
    const candidateSpy = vi
      .spyOn(candidateModule, 'collectRosterCandidates')
      .mockImplementation((mails) => ({
        candidateMessages: 1,
        candidateAttachments: 1,
        candidateBodies: 0,
        selected: [{
          mail: mails[0]!,
          decision: {
            candidate: true,
            reasons: ['test_selected_attachment'],
            inferredRosterType: 'confirmed',
            inferredGrade: 'A',
            sources: [{
              sourceKind: 'attachment',
              attachmentIndex: 0,
              filename: 'A邏・遒ｺ螳壼錐邁ｿ.pdf',
              inferredRosterType: 'confirmed',
              inferredGrade: 'A',
            }],
          },
        }],
        skippedByCandidateLimit: 0,
        aiEligible: [],
      }))

    let summary: PipelineSummary
    try {
      summary = await runPipelineFromFixtures([{ source: rosterMail, imapUid: 501 }], {
        mailbox: '99_202510莉･蜑阪・繝｡繝ｼ繝ｫ',
        fromYear: 2024,
        toYear: 2024,
        maxRosterCandidates: 1,
        maxRosterAiCalls: 0,
        resumeAfterUid: 500,
        stageRosterDrafts: true,
      })
    } finally {
      candidateSpy.mockRestore()
    }

    expect(summary).toMatchObject({
      rosterCandidatesSelected: 1,
      rosterDraftsCreated: 0,
      rosterDraftsFailed: 1,
      resumeCursorBlockedByFailure: true,
      nextResumeCursor: 500,
    })
  })

  it('resumes an archive dry-run by IMAP UID and returns a stable next cursor', async () => {
    const rosterMail = (id: string, day: number) => Buffer.from([
      `Message-ID: <${id}@example.test>`,
      'From: organizer@example.test',
      'To: receiver@example.test',
      `Date: ${day} Aug 2024 09:00:00 +0900`,
      'Subject: =?UTF-8?B?QS 級 確定名簿?=',
      '',
      'A級の確定名簿を送付します。',
    ].join('\r\n'))
    const fixtures = [
      { source: rosterMail('cursor-101', 1), imapUid: 101 },
      { source: rosterMail('cursor-102', 2), imapUid: 102 },
      { source: rosterMail('cursor-103', 3), imapUid: 103 },
    ]
    const options = {
      dryRun: true,
      mailbox: '99_202510以前のメール',
      fromYear: 2024,
      toYear: 2024,
      maxRosterCandidates: 1,
      maxRosterAiCalls: 0,
      resumeAfterUid: 101,
    }

    const first = await runPipelineFromFixtures(fixtures, options)
    const repeated = await runPipelineFromFixtures(fixtures, options)
    expect(first).toMatchObject({
      fetched: 2,
      skippedByResumeCursor: 1,
      rosterCandidatesSelected: 1,
      rosterCandidatesSkippedByLimit: 1,
      nextResumeCursor: 102,
      resumeCursorBlockedByFailure: false,
    })
    expect(repeated).toEqual(first)

    const second = await runPipelineFromFixtures(fixtures, {
      ...options,
      resumeAfterUid: first.nextResumeCursor!,
    })
    expect(second).toMatchObject({
      fetched: 1,
      skippedByResumeCursor: 2,
      rosterCandidatesSelected: 1,
      rosterCandidatesSkippedByLimit: 0,
      nextResumeCursor: 103,
    })
    expect(await testDb.select().from(mailMessages)).toHaveLength(0)
  })

  it('does not advance the resume cursor past a failed IMAP message', async () => {
    const candidate = Buffer.from([
      'Message-ID: <cursor-success@example.test>',
      'From: organizer@example.test',
      'To: receiver@example.test',
      'Date: Thu, 1 Aug 2024 09:00:00 +0900',
      'Subject: A級 確定名簿',
      '',
      'A級の確定名簿を送付します。',
    ].join('\r\n'))
    const missingMessageId = Buffer.from([
      'From: broken@example.test',
      'To: receiver@example.test',
      'Date: Fri, 2 Aug 2024 09:00:00 +0900',
      'Subject: parse failure',
      '',
      'Message-IDがないため再処理が必要です。',
    ].join('\r\n'))

    const summary = await runPipelineFromFixtures([
      { source: candidate, imapUid: 101 },
      { source: missingMessageId, imapUid: 102 },
    ], {
      dryRun: true,
      mailbox: '99_202510以前のメール',
      fromYear: 2024,
      toYear: 2024,
      resumeAfterUid: 100,
    })

    expect(summary).toMatchObject({
      fetched: 2,
      failed: 1,
      nextResumeCursor: 101,
      resumeCursorBlockedByFailure: true,
    })
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

  it('isolates per-mail parse errors: one unparseable mail bumps failed and the rest still persist', async () => {
    // Eml without Message-ID — fetcher cannot key it for de-dup, so it goes
    // to `errors` instead of `prepared`. The other two mails must still
    // insert cleanly and the summary must reflect 1 failure.
    const NO_MESSAGE_ID_EML = Buffer.from(
      [
        'From: ghost@example.com',
        'To: us@example.com',
        'Subject: I lost my Message-ID',
        'Date: Tue, 14 Apr 2026 09:00:00 +0900',
        '',
        'Body without an ID.',
        '',
      ].join('\r\n'),
    )

    const warnSpy = vi.fn()
    const summary = await runPipelineFromFixtures(
      [
        { source: await loadFixture('personal-mail.eml'), imapUid: 10 },
        { source: NO_MESSAGE_ID_EML, imapUid: 11 },
        { source: await loadFixture('tournament-announcement.eml'), imapUid: 12 },
      ],
      { logger: { info: vi.fn(), warn: warnSpy } },
    )

    // fetched counts every mail the source saw, including failures.
    expect(summary.fetched).toBe(3)
    expect(summary.inserted).toBe(2)
    expect(summary.failed).toBe(1)

    expect(warnSpy).toHaveBeenCalledWith(
      'mail fetch failed',
      expect.objectContaining({
        stage: 'parse_failed',
        imapUid: 11,
      }),
    )

    const rows = await testDb.select().from(mailMessages)
    expect(rows).toHaveLength(2)
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
        { source: await loadFixture('tournament-announcement.eml'), imapUid: 10 },
        { source: await loadFixture('newsletter-with-unsubscribe.eml'), imapUid: 11 },
        { source: await loadFixture('personal-mail.eml'), imapUid: 12 },
      ],
      { logger: { info: vi.fn(), warn: warnSpy }, resumeAfterUid: 0 },
    )

    expect(summary.fetched).toBe(3)
    expect(summary.inserted).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.nextResumeCursor).toBe(10)
    expect(summary.resumeCursorBlockedByFailure).toBe(true)

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
