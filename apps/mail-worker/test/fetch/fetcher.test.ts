import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { fetchMails, FixtureMailSource } from '../../src/fetch/fetcher.js'

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url))

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

/** RFC 822 buffer with no Message-ID — used to exercise the parse-error path. */
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

describe('fetchMails (FixtureMailSource)', () => {
  it('parses three fixture eml files into ParsedMailMeta', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('tournament-announcement.eml'), imapUid: 100 },
      { source: await loadFixture('newsletter-with-unsubscribe.eml'), imapUid: 101 },
      { source: await loadFixture('personal-mail.eml'), imapUid: 102 },
    ])

    const result = await fetchMails(source, undefined)
    expect(result.prepared).toHaveLength(3)
    expect(result.errors).toHaveLength(0)
    const subjects = result.prepared.map((p) => p.meta.subject)
    expect(subjects).toContain('Weekly Update: New Features Available')
    expect(subjects).toContain('Re: Lunch next week?')
    // tournament subject is RFC 2047 base64 — mailparser decodes it
    expect(
      subjects.some((s) => s?.includes('第65回全日本選手権大会')),
    ).toBe(true)
    await source.close()
  })

  it('flags newsletter-with-unsubscribe as noise via header pre-filter', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('newsletter-with-unsubscribe.eml') },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared).toHaveLength(1)
    expect(result.prepared[0]!.noise).toBe(true)
    await source.close()
  })

  it('does NOT flag personal mail or tournament announcement as noise', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('personal-mail.eml') },
      { source: await loadFixture('tournament-announcement.eml') },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared).toHaveLength(2)
    for (const p of result.prepared) {
      expect(p.noise).toBe(false)
    }
    await source.close()
  })

  it('does NOT flag ML announcements (List-Id + Precedence: list + List-Unsubscribe)', async () => {
    // Real taikai-ajka mails carry every header that *looks* like a newsletter.
    // The pre-filter must let them through so AI extraction can run.
    const source = new FixtureMailSource([
      { source: await loadFixture('ml-tournament-announcement.eml') },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared).toHaveLength(1)
    expect(result.prepared[0]!.noise).toBe(false)
    await source.close()
  })

  it('respects since: filters out mails older than the cutoff', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('tournament-announcement.eml') }, // 2026-04-08
      { source: await loadFixture('newsletter-with-unsubscribe.eml') }, // 2026-04-13
      { source: await loadFixture('personal-mail.eml') }, // 2026-04-14
    ])
    const result = await fetchMails(source, new Date('2026-04-12T00:00:00+09:00'))
    expect(result.prepared).toHaveLength(2)
    const subjects = result.prepared.map((p) => p.meta.subject)
    expect(subjects).toContain('Weekly Update: New Features Available')
    expect(subjects).toContain('Re: Lunch next week?')
    await source.close()
  })

  it('extracts Message-ID header into meta.messageId for de-dup', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('personal-mail.eml') },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared[0]!.meta.messageId).toBe(
      '<CACmawxz-personal-001@mail.gmail.com>',
    )
    await source.close()
  })

  it('parses From: into address + display name', async () => {
    const source = new FixtureMailSource([
      { source: await loadFixture('personal-mail.eml') },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared[0]!.meta.fromAddress).toBe('friend@example.org')
    expect(result.prepared[0]!.meta.fromName).toBe('Yamada Taro')
    await source.close()
  })

  it('captures parse errors per-mail without aborting the batch', async () => {
    // Mail 2 is missing Message-ID — without per-mail isolation it would
    // silently disappear; we want it surfaced as `errors` while the others
    // still parse successfully.
    const source = new FixtureMailSource([
      { source: await loadFixture('personal-mail.eml'), imapUid: 1 },
      { source: NO_MESSAGE_ID_EML, imapUid: 2 },
      { source: await loadFixture('tournament-announcement.eml'), imapUid: 3 },
    ])
    const result = await fetchMails(source, undefined)
    expect(result.prepared).toHaveLength(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!).toMatchObject({
      imapUid: 2,
      stage: 'parse_failed',
    })
    expect(result.errors[0]!.reason).toMatch(/message-id/i)
    await source.close()
  })
})
