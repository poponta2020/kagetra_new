import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

  it('rejects calendar-day overflow like 2026-04-31 even though Date silently rolls it forward', () => {
    // Review r3 Nit: `new Date('2026-04-31T00:00:00+09:00')` does NOT
    // produce NaN; it normalises to 2026-05-01 JST, which would silently
    // shift an operator's `--since` by a day. The round-trip check must
    // reject it so the operator sees the typo.
    expect(() =>
      parseReextractArgs(['node', 'reextract.ts', '--since=2026-04-31']),
    ).toThrow(/2026-04-31/)
  })

  it('rejects malformed date shapes (not YYYY-MM-DD)', () => {
    // Single-digit month/day, ISO datetime, garbage strings — all rejected
    // up front by the regex.
    expect(() =>
      parseReextractArgs(['node', 'reextract.ts', '--since=2026-4-1']),
    ).toThrow(/YYYY-MM-DD/)
    expect(() =>
      parseReextractArgs([
        'node',
        'reextract.ts',
        '--since=2026-04-15T09:00:00Z',
      ]),
    ).toThrow(/YYYY-MM-DD/)
    expect(() =>
      parseReextractArgs(['node', 'reextract.ts', '--since=yesterday']),
    ).toThrow(/YYYY-MM-DD/)
  })

  it('throws on unknown flags instead of silently dropping them', () => {
    // Review r3 Nit: a typo like `--include-prefiler-noise` previously fell
    // through the `if`/`else if` chain and the operator would think the
    // run included pre-filter noise when it didn't.
    expect(() =>
      parseReextractArgs([
        'node',
        'reextract.ts',
        '--since=2026-04-01',
        '--include-prefiler-noise',
      ]),
    ).toThrow(/unknown flag/)
  })
})

describe('reextract CLI entrypoint', () => {
  it('prints usage when invoked as a script with --help on every platform', () => {
    // Review r3 Should fix: the entrypoint guard previously compared
    // `import.meta.url` against a hand-built `file://${argv[1]}`, which is
    // off by one slash on Windows (`file://C:/...` vs `file:///C:/...`).
    // The result was that `tsx src/reextract.ts --help` exited 0 with no
    // output, leaving operators thinking re-extracts succeeded when in
    // fact the CLI body never ran.
    //
    // We invoke the script via the local `tsx` and assert usage shows up
    // on stdout. This catches a regression from any future entrypoint
    // tweak (e.g. switching to a different URL helper).
    const reextractPath = fileURLToPath(
      new URL('../src/reextract.ts', import.meta.url),
    )
    // `npx --no-install tsx` would also work but is slower; `pnpm exec`
    // is already on PATH in CI and dev. Use shell:true so Windows can
    // resolve the `pnpm.cmd` shim (matches the rest of the test suite —
    // see the test-db helper).
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', reextractPath, '--help'],
      {
        encoding: 'utf8',
        shell: true,
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--include-prefilter-noise')
  }, 30_000)
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
