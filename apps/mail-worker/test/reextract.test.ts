import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailMessages, tournamentDrafts } from '@kagetra/shared/schema'

/**
 * mail-ai-extract-refinements (PR #431 review blocker): `reextract`'s
 * per-mail loop calls `classifyMail` directly, so the wiring tests below stub
 * it out (and `persistOutcome`, which would otherwise try to write a draft
 * from a fake `ClassifyOutcome`) to assert on the `selectedAttachmentIds`
 * `main()` actually threads through — the exact thing the CLI got wrong.
 * `classifyMail`'s own attachment-filtering behaviour is already covered by
 * `test/classify/classifier.test.ts` (AC-20 / AC-30); we don't re-test that
 * here.
 */
const { classifyMailMock, persistOutcomeMock } = vi.hoisted(() => ({
  classifyMailMock: vi.fn(),
  persistOutcomeMock: vi.fn(),
}))

vi.mock('../src/classify/classifier.js', () => ({
  classifyMail: classifyMailMock,
  persistOutcome: persistOutcomeMock,
}))

import {
  parseReextractArgs,
  selectReextractTargets,
  runReextract,
} from '../src/reextract.js'
import { closeDb } from '../src/db.js'
import { resetConfigForTests } from '../src/config.js'
import { closeTestDb, testDb, truncateMailTables } from './test-db.js'

const SINCE = new Date('2026-04-01T00:00:00+09:00')

// Status union is derived from the schema's insert type so a new
// mail_message_status enum value (oversize_skipped, etc.) is picked up
// automatically. The previous hand-rolled union silently rotted whenever the
// enum grew (review r1 blocker on PR #31).
type SeedMailStatus = NonNullable<typeof mailMessages.$inferInsert.status>

interface SeedRow {
  messageId: string
  status: SeedMailStatus
  classification: 'tournament' | 'noise' | 'unknown' | null
  receivedAt?: Date
}

async function seedMail(row: SeedRow): Promise<number> {
  const inserted = await testDb
    .insert(mailMessages)
    .values({
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
    .returning({ id: mailMessages.id })
  return inserted[0]!.id
}

/**
 * Seeds a `tournament_drafts` row for `mailMessageId` with a given
 * `selected_attachment_ids`. Passing `undefined` (the default) leaves the
 * column at its schema default (`NULL`) — the "no selection recorded" state.
 */
async function seedDraft(opts: {
  mailMessageId: number
  selectedAttachmentIds?: number[] | null
}): Promise<void> {
  await testDb.insert(tournamentDrafts).values({
    messageId: opts.mailMessageId,
    selectedAttachmentIds: opts.selectedAttachmentIds ?? null,
    promptVersion: 'test-prompt',
    aiModel: 'test-model',
  })
}

describe('parseReextractArgs', () => {
  it('defaults includePrefilterNoise to false', () => {
    const args = parseReextractArgs(['node', 'reextract.ts', '--since=2026-04-01'])
    expect(args.includePrefilterNoise).toBe(false)
    expect(args.help).toBe(false)
    expect(args.since?.toISOString()).toBe('2026-03-31T15:00:00.000Z')
    expect(args.statuses).toEqual([
      'ai_done',
      'ai_failed',
      'archived',
      'ai_processing',
      'oversize_skipped',
    ])
  })

  it('defaults statuses to all VALID_STATUSES', () => {
    const args = parseReextractArgs(['node', 'reextract.ts', '--since=2026-04-01'])
    expect(args.statuses).toHaveLength(5)
    expect(args.statuses).toEqual([
      'ai_done',
      'ai_failed',
      'archived',
      'ai_processing',
      'oversize_skipped',
    ])
  })

  it('parses --status=ai_processing as single-element array', () => {
    const args = parseReextractArgs([
      'node',
      'reextract.ts',
      '--since=2026-04-01',
      '--status=ai_processing',
    ])
    expect(args.statuses).toEqual(['ai_processing'])
  })

  it('parses --status=ai_done,ai_failed as multi-element array (preserves order)', () => {
    const args = parseReextractArgs([
      'node',
      'reextract.ts',
      '--since=2026-04-01',
      '--status=ai_done,ai_failed',
    ])
    expect(args.statuses).toEqual(['ai_done', 'ai_failed'])
  })

  it('throws on --status=invalid_status with the invalid name in the error message', () => {
    expect(() =>
      parseReextractArgs([
        'node',
        'reextract.ts',
        '--since=2026-04-01',
        '--status=invalid_status',
      ]),
    ).toThrow(/invalid_status/)
  })

  it('throws on empty --status= with a "non-empty CSV" message', () => {
    expect(() =>
      parseReextractArgs([
        'node',
        'reextract.ts',
        '--since=2026-04-01',
        '--status=',
      ]),
    ).toThrow(/non-empty CSV/)
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
    expect(args.statuses).toEqual([
      'ai_done',
      'ai_failed',
      'archived',
      'ai_processing',
      'oversize_skipped',
    ])
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
    expect(result.stdout).toContain('--status=')
  }, 30_000)
})

describe('selectReextractTargets', () => {
  beforeEach(async () => {
    await truncateMailTables()
  })

  it('picks up AI-touched terminal states by default (ai_done / ai_failed / archived / ai_processing / oversize_skipped)', async () => {
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
    await seedMail({
      messageId: '<oversize-1@example.com>',
      status: 'oversize_skipped',
      classification: null,
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: false,
      statuses: ['ai_done', 'ai_failed', 'archived', 'ai_processing', 'oversize_skipped'],
    })

    expect(targets).toHaveLength(5)
    expect(new Set(targets.map((t) => t.messageId))).toEqual(
      new Set([
        '<done-1@example.com>',
        '<failed-1@example.com>',
        '<archived-1@example.com>',
        '<processing-1@example.com>',
        '<oversize-1@example.com>',
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
      statuses: ['ai_done', 'ai_failed', 'archived', 'ai_processing'],
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
      statuses: ['ai_done', 'ai_failed', 'archived', 'ai_processing'],
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
      statuses: ['ai_done', 'ai_failed', 'archived', 'ai_processing'],
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
      statuses: ['ai_done', 'ai_failed', 'archived', 'ai_processing'],
    })
    expect(targets).toHaveLength(1)
    expect(targets[0]!.messageId).toBe('<in-window@example.com>')
  })

  it('respects statuses subset (only ai_processing rows returned even when ai_done present)', async () => {
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
      messageId: '<processing-1@example.com>',
      status: 'ai_processing',
      classification: null,
    })
    await seedMail({
      messageId: '<archived-1@example.com>',
      status: 'archived',
      classification: 'tournament',
    })

    const targets = await selectReextractTargets(testDb, {
      since: SINCE,
      includePrefilterNoise: false,
      statuses: ['ai_processing'],
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]!.messageId).toBe('<processing-1@example.com>')
  })
})

describe('reextract main() attachment-selection wiring', () => {
  const originalArgv = process.argv

  beforeEach(async () => {
    await truncateMailTables()
    classifyMailMock.mockReset()
    persistOutcomeMock.mockReset()
    // `skipped_noise` is the cheapest valid `ClassifyOutcome` — the wiring
    // under test is what `main()` passes INTO `classifyMail`, not what it
    // does with the result.
    classifyMailMock.mockResolvedValue({ kind: 'skipped_noise' })
    persistOutcomeMock.mockResolvedValue({
      draftsInserted: 0,
      draftsUpdated: 0,
      draftsPreserved: 0,
      aiSucceeded: 0,
      aiFailed: 0,
      aiSkipped: 1,
    })
    resetConfigForTests()
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.unstubAllEnvs()
  })

  it('passes only the saved ids to classifyMail when selected_attachment_ids is a non-empty array', async () => {
    const mailId = await seedMail({
      messageId: '<selected-subset@example.com>',
      status: 'ai_done',
      classification: 'tournament',
    })
    await seedDraft({ mailMessageId: mailId, selectedAttachmentIds: [101, 102] })

    process.argv = ['node', 'reextract.ts', '--since=2026-04-01', '--status=ai_done']
    const code = await runReextract()

    expect(code).toBe(0)
    expect(classifyMailMock).toHaveBeenCalledTimes(1)
    const [, calledMailId, , opts] = classifyMailMock.mock.calls[0]!
    expect(calledMailId).toBe(mailId)
    expect(opts).toMatchObject({ force: true })
    expect(opts.selectedAttachmentIds).toEqual([101, 102])
  })

  it('passes [] (not undefined) to classifyMail when selected_attachment_ids is an empty array — "本文だけで実行" must not revert to "全添付"', async () => {
    const mailId = await seedMail({
      messageId: '<selected-empty@example.com>',
      status: 'ai_done',
      classification: 'tournament',
    })
    await seedDraft({ mailMessageId: mailId, selectedAttachmentIds: [] })

    process.argv = ['node', 'reextract.ts', '--since=2026-04-01', '--status=ai_done']
    const code = await runReextract()

    expect(code).toBe(0)
    expect(classifyMailMock).toHaveBeenCalledTimes(1)
    const [, , , opts] = classifyMailMock.mock.calls[0]!
    expect(opts.selectedAttachmentIds).toEqual([])
    expect(opts.selectedAttachmentIds).not.toBeUndefined()
  })

  it('passes undefined to classifyMail when the draft has no recorded selection (NULL) — preserves the "全添付" default', async () => {
    const mailId = await seedMail({
      messageId: '<no-selection@example.com>',
      status: 'ai_done',
      classification: 'tournament',
    })
    await seedDraft({ mailMessageId: mailId, selectedAttachmentIds: null })

    process.argv = ['node', 'reextract.ts', '--since=2026-04-01', '--status=ai_done']
    const code = await runReextract()

    expect(code).toBe(0)
    expect(classifyMailMock).toHaveBeenCalledTimes(1)
    const [, , , opts] = classifyMailMock.mock.calls[0]!
    expect(opts.selectedAttachmentIds).toBeUndefined()
  })
})

afterAll(async () => {
  await closeDb()
  await closeTestDb()
})
