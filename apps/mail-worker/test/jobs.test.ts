import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { mailWorkerJobs, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateMailWorkerTables } from './test-db.js'
import { closeDb, getDb } from '../src/db.js'
import {
  claimNextJob,
  markJobDone,
  markJobFailed,
  recoverStaleClaimedJobs,
  STALE_CLAIM_RECOVERY_MS,
} from '../src/jobs.js'

const ADMIN_USER_ID = 'user-admin-1'

async function truncateUsers() {
  // `users` references nothing the jobs queue cares about; CASCADE here
  // pulls the FK from mail_worker_jobs / mail_worker_runs (`triggered_by`,
  // `requested_by`) but those tables are already truncated by
  // `truncateMailWorkerTables` first.
  await testDb.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
}

async function seedAdmin() {
  await testDb.insert(users).values({
    id: ADMIN_USER_ID,
    name: 'Admin',
    email: 'admin@example.com',
    role: 'admin',
  })
}

async function seedJob(opts: { since?: Date | null } = {}): Promise<number> {
  const inserted = await testDb
    .insert(mailWorkerJobs)
    .values({
      requestedByUserId: ADMIN_USER_ID,
      since: opts.since ?? null,
      status: 'pending',
    })
    .returning({ id: mailWorkerJobs.id })
  return inserted[0]!.id
}

describe('jobs queue', () => {
  beforeEach(async () => {
    await truncateMailWorkerTables()
    await truncateUsers()
    await seedAdmin()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('claimNextJob picks the oldest pending job and flips status to claimed', async () => {
    const since = new Date('2026-04-01T00:00:00+09:00')
    const id = await seedJob({ since })

    const claimed = await claimNextJob(getDb())
    expect(claimed).not.toBeNull()
    expect(claimed!.id).toBe(id)
    expect(claimed!.requestedByUserId).toBe(ADMIN_USER_ID)
    expect(claimed!.since?.toISOString()).toBe(since.toISOString())

    // DB state: status=claimed, claimed_at populated.
    const row = (await testDb.select().from(mailWorkerJobs))[0]!
    expect(row.status).toBe('claimed')
    expect(row.claimedAt).not.toBeNull()
  })

  it('returns null when no pending jobs are available', async () => {
    const claimed = await claimNextJob(getDb())
    expect(claimed).toBeNull()
  })

  it('two sequential claims return the two pending jobs in FIFO order', async () => {
    // Distinct since values so we can verify the second claim returns the
    // second row (not the first one re-claimed).
    const sinceA = new Date('2026-04-01T00:00:00+09:00')
    const sinceB = new Date('2026-04-02T00:00:00+09:00')
    const idA = await seedJob({ since: sinceA })
    const idB = await seedJob({ since: sinceB })

    const first = await claimNextJob(getDb())
    expect(first?.id).toBe(idA)
    const second = await claimNextJob(getDb())
    expect(second?.id).toBe(idB)
    const third = await claimNextJob(getDb())
    expect(third).toBeNull()
  })

  it('markJobDone sets status=done and links the run id', async () => {
    const id = await seedJob()
    await claimNextJob(getDb())

    // We don't actually need a real run row here — `runId` is a plain int
    // column with FK ON DELETE SET NULL, but the FK still requires the
    // referenced row to exist. Insert a placeholder run for the FK.
    const inserted = await testDb.execute<{ id: number }>(sql`
      INSERT INTO mail_worker_runs (started_at, kind, status)
      VALUES (now(), 'manual', 'success')
      RETURNING id
    `)
    const runId = (inserted.rows[0] as { id: number }).id

    await markJobDone(getDb(), id, runId)

    const row = (await testDb.select().from(mailWorkerJobs))[0]!
    expect(row.status).toBe('done')
    expect(row.runId).toBe(runId)
    expect(row.error).toBeNull()
  })

  it('recoverStaleClaimedJobs flips claimed rows older than the threshold back to pending', async () => {
    // Seed a claimed job whose claimed_at is well past the stale threshold
    // (simulates a worker that died after claiming). The dispatcher must be
    // able to re-claim it on the next tick — otherwise the queue is stuck.
    await seedJob()
    const claimed = await claimNextJob(getDb())
    expect(claimed).not.toBeNull()

    // Force claimed_at into the past by 2 hours (threshold is 1 hour).
    const ancient = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await testDb.execute(
      sql`UPDATE mail_worker_jobs SET claimed_at = ${ancient} WHERE id = ${claimed!.id}`,
    )

    const recovered = await recoverStaleClaimedJobs(getDb())
    expect(recovered).toBe(1)

    // Row is back to pending and claimed_at is cleared (so the next claim
    // stamps a fresh timestamp instead of inheriting the dead worker's).
    const row = (await testDb.select().from(mailWorkerJobs))[0]!
    expect(row.status).toBe('pending')
    expect(row.claimedAt).toBeNull()

    // ...and the dispatcher can now re-claim it cleanly.
    const reclaimed = await claimNextJob(getDb())
    expect(reclaimed?.id).toBe(claimed!.id)
  })

  it('recoverStaleClaimedJobs leaves recently claimed rows alone (no thrashing)', async () => {
    await seedJob()
    const claimed = await claimNextJob(getDb())
    expect(claimed).not.toBeNull()
    // Don't touch claimed_at — it's `now()` and not stale.

    const recovered = await recoverStaleClaimedJobs(getDb())
    expect(recovered).toBe(0)

    const row = (await testDb.select().from(mailWorkerJobs))[0]!
    expect(row.status).toBe('claimed')
    expect(row.claimedAt).not.toBeNull()
  })

  it('STALE_CLAIM_RECOVERY_MS is well above the systemd timer interval', () => {
    // The timer runs every 30 minutes (per docs/deploy/mail-worker.md).
    // The recovery threshold must be strictly larger so we never race a
    // pipeline that's still legitimately running.
    expect(STALE_CLAIM_RECOVERY_MS).toBeGreaterThan(30 * 60 * 1000)
  })

  it('markJobFailed records the error string and supports a null run id', async () => {
    const id = await seedJob()
    await claimNextJob(getDb())

    await markJobFailed(getDb(), id, 'IMAP failed before run row was created', null)

    const row = (await testDb.select().from(mailWorkerJobs))[0]!
    expect(row.status).toBe('failed')
    expect(row.error).toBe('IMAP failed before run row was created')
    expect(row.runId).toBeNull()
  })
})
