import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mailMessages } from '@kagetra/shared/schema'
import {
  parseReextractArgs,
  selectReextractTargets,
} from '../src/reextract.js'
import { closeDb } from '../src/db.js'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'

const SINCE = new Date('2026-04-01T00:00:00+09:00')

interface SeedRow {
  messageId: string
  status:
    | 'pending'
    | 'fetched'
    | 'parse_failed'
    | 'fetch_failed'
    | 'ai_processing'
    | 'ai_done'
    | 'ai_failed'
    | 'archived'
  classification: 'tournament' | 'noise' | 'unknown' | null
  receivedAt?: Date
}

async function seedMail(row: SeedRow): Promise<void> {
  await testDb.insert(mailMessages).values({
    messageId: row.messageId,
    fromAddress: 'sender@example.com',
    fromName: null,
    toAddresses: ['org@example.com'],
    subject: `subject-${row.messageId}`,
    receivedAt: row.receivedAt ?? new Date('2026-04-15T09:00:00+09:00'),
    bodyText: 'body',
    bodyHtml: null,
    classification: row.classification,
    status: row.status,
    imapUid: null,
    imapBox: null,
  })
}

describe('parseReextractArgs', () => {
  it('defaults includePrefilterNoise to false', () => {
    const args = parseReextractArgs(['node', 'reextract.ts', '--since=2026-04-01'])
    expect(args.includePrefilterNoise).toBe(false)
    expect(args.help).toBe(false)
    expect(args.since?.toISOString()).toBe('2026-03-31T15:00:00.000Z')
  })

  it('sets includePrefilterNoise=true when --include-prefilter-noise is passed', () => {
    const args = parseReextractArgs([
      'node',
      'reextract.ts',
      '--since=2026-04-01',
      '--include-prefilter-noise',
    ])
    expect(args.includePrefilterNoise).toBe(true)
  })

  it('still treats --help / -h independent of the new flag', () => {
    const args = parseReextractArgs(['node', 'reextract.ts', '--help'])
    expect(args.help).toBe(true)
    expect(args.includePrefilterNoise).toBe(false)
  })
})

describe('selectReextractTargets', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('picks up AI-touched terminal states by default (ai_done / ai_failed / archived / ai_processing)', async () => {
    await seedMail({
      messageId: '<done-1@example.com>',
      status: 'ai_done',
      classification: 'tournament',
    })
    await seedMail({
      messageId: '<failed-1@example.com>',
      status: 'ai_failed',
      classification: null,
    })
    await seedMail({
      messageId: '<archived-1@example.com>',
      status: 'archived',
      classification: 'tournament',
    })
    await seedMail({
      messageId: '<processing-1@example.com>',
      status: 'ai_processing',
      classification: null,
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: false,
    })

    expect(targets).toHaveLength(4)
    expect(new Set(targets.map((t) => t.messageId))).toEqual(
      new Set([
        '<done-1@example.com>',
        '<failed-1@example.com>',
        '<archived-1@example.com>',
        '<processing-1@example.com>',
      ]),
    )
  })

  it('skips pre-filter noise rows by default (status=fetched, classification=noise)', async () => {
    // Pre-filter noise: PR1 set classification=noise on insert and the AI
    // phase short-circuited, so the row stayed at status=fetched. By default
    // these are owned by the regular pipeline and the CLI must not touch
    // them — operators get them via the explicit opt-in flag.
    await seedMail({
      messageId: '<prefilter-noise@example.com>',
      status: 'fetched',
      classification: 'noise',
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: false,
    })
    expect(targets).toHaveLength(0)
  })

  it('includes pre-filter noise rows when includePrefilterNoise=true', async () => {
    await seedMail({
      messageId: '<prefilter-noise@example.com>',
      status: 'fetched',
      classification: 'noise',
    })
    await seedMail({
      messageId: '<done-1@example.com>',
      status: 'ai_done',
      classification: 'tournament',
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: true,
    })
    expect(new Set(targets.map((t) => t.messageId))).toEqual(
      new Set(['<prefilter-noise@example.com>', '<done-1@example.com>']),
    )
  })

  it('does NOT include status=fetched rows whose classification is null even with the flag', async () => {
    // Defensive guard: a `fetched` row with NULL classification is owned by
    // the regular pipeline's recovery branch (worker crashed between mail
    // insert and AI). The CLI must not race with that path — only the
    // pre-filter noise subset is folded in.
    await seedMail({
      messageId: '<crashed-mid-insert@example.com>',
      status: 'fetched',
      classification: null,
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: true,
    })
    expect(targets).toHaveLength(0)
  })

  it('respects since cutoff (received_at >= since)', async () => {
    await seedMail({
      messageId: '<too-old@example.com>',
      status: 'ai_done',
      classification: 'tournament',
      receivedAt: new Date('2026-03-15T09:00:00+09:00'),
    })
    await seedMail({
      messageId: '<in-window@example.com>',
      status: 'ai_done',
      classification: 'tournament',
      receivedAt: new Date('2026-04-15T09:00:00+09:00'),
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: false,
    })
    expect(targets).toHaveLength(1)
    expect(targets[0]!.messageId).toBe('<in-window@example.com>')
  })
})
