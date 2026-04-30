import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { mailWorkerJobs } from '@kagetra/shared/schema'
import type { Db } from './db.js'

/**
 * How long a `claimed` row may sit before the dispatcher recovers it back to
 * `pending`. The systemd timer fires every 30 min and pipelines normally
 * complete in seconds — a row idle in `claimed` for an hour is, in practice,
 * always an orphan from a worker crash / kill / host reboot. Set well above
 * the timer interval so we never race a still-running pipeline.
 *
 * Pre-fix: there was no recovery at all. A worker killed mid-claim left the
 * job stuck in `claimed` forever, and `claimNextJob` only picks up `pending`,
 * so subsequent admin triggers piled up behind the dead row (review r1).
 */
export const STALE_CLAIM_RECOVERY_MS = 60 * 60 * 1000 // 1 hour

/**
 * `mail_worker_jobs` queue ops for the dispatcher (PR5 Phase 3c).
 *
 * The queue is single-consumer in the production cron model — only one
 * mail-worker process runs at a time — but `claimNextJob` still uses
 * `FOR UPDATE SKIP LOCKED` so a future move to multiple workers (or a
 * concurrent `--once` invocation) can't double-execute the same job.
 *
 * The claim runs inside a short transaction (SELECT…FOR UPDATE + UPDATE),
 * deliberately separate from the pipeline's main DB activity which would
 * hold the transaction open while IMAP / Anthropic round-trip.
 */

export type ClaimedJob = {
  id: number
  requestedByUserId: string
  /** `--since` cutoff requested by the admin, or null for default lookback. */
  since: Date | null
  requestedAt: Date
}

/**
 * Atomically pick the oldest pending job and mark it `claimed`. Returns
 * `null` if no pending jobs are available — the caller falls back to a
 * regular cron tick.
 *
 * Implementation note: Drizzle's `.for('update', { skipLocked: true })`
 * generates `FOR UPDATE SKIP LOCKED`, the standard Postgres pattern for a
 * non-blocking queue claim. The SELECT and UPDATE both live inside the same
 * transaction so the row's lock is released only after the status flip
 * commits — no other worker can see it as pending.
 */
export async function claimNextJob(db: Db): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mailWorkerJobs.id,
        requestedByUserId: mailWorkerJobs.requestedByUserId,
        since: mailWorkerJobs.since,
        requestedAt: mailWorkerJobs.requestedAt,
      })
      .from(mailWorkerJobs)
      .where(eq(mailWorkerJobs.status, 'pending'))
      .orderBy(asc(mailWorkerJobs.requestedAt))
      .limit(1)
      .for('update', { skipLocked: true })
    if (candidates.length === 0) return null
    const candidate = candidates[0]!

    const updated = await tx
      .update(mailWorkerJobs)
      .set({ status: 'claimed', claimedAt: sql`now()` })
      .where(and(eq(mailWorkerJobs.id, candidate.id), eq(mailWorkerJobs.status, 'pending')))
      .returning({
        id: mailWorkerJobs.id,
        requestedByUserId: mailWorkerJobs.requestedByUserId,
        since: mailWorkerJobs.since,
        requestedAt: mailWorkerJobs.requestedAt,
      })
    if (updated.length === 0) {
      // Should be impossible while we hold the row lock, but stay defensive
      // — return null so the dispatcher falls back to a cron run.
      return null
    }
    const row = updated[0]!
    return {
      id: row.id,
      requestedByUserId: row.requestedByUserId,
      since: row.since,
      requestedAt: row.requestedAt,
    }
  })
}

/**
 * Reset rows stuck in `claimed` past the stale threshold back to `pending`
 * so the dispatcher can re-claim them. Returns the number of rows recovered.
 *
 * Intended to be called once per dispatcher tick before `claimNextJob`. The
 * UPDATE is a single statement (no transaction needed) — Postgres serialises
 * concurrent recoveries via row-level locks, and a job that another worker
 * just legitimately re-claimed will simply skip the WHERE filter on the next
 * comparison. Safer than reading-then-writing with a race window.
 *
 * `claimedAt` is set back to NULL on recovery so the next claim attempt
 * stamps it fresh — without this, the row's claimedAt would carry the dead
 * worker's timestamp into the new run and confuse troubleshooting.
 */
export async function recoverStaleClaimedJobs(
  db: Db,
  staleAfterMs: number = STALE_CLAIM_RECOVERY_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const recovered = await db
    .update(mailWorkerJobs)
    .set({ status: 'pending', claimedAt: null })
    .where(
      and(
        eq(mailWorkerJobs.status, 'claimed'),
        isNotNull(mailWorkerJobs.claimedAt),
        lt(mailWorkerJobs.claimedAt, cutoff),
      ),
    )
    .returning({ id: mailWorkerJobs.id })
  return recovered.length
}

/**
 * Mark a successfully executed job as `done` and link the produced run id.
 * `runId` is required here — a successful execution must have created a run.
 */
export async function markJobDone(
  db: Db,
  jobId: number,
  runId: number,
): Promise<void> {
  await db
    .update(mailWorkerJobs)
    .set({ status: 'done', runId, error: null })
    .where(eq(mailWorkerJobs.id, jobId))
}

/**
 * Mark a failed job. `runId` is nullable because a job can fail BEFORE the
 * `mail_worker_runs` row was inserted (e.g. dispatcher crashed between claim
 * and run-row creation). When provided it points at the run row that
 * captured the error in detail.
 */
export async function markJobFailed(
  db: Db,
  jobId: number,
  error: string,
  runId: number | null = null,
): Promise<void> {
  await db
    .update(mailWorkerJobs)
    .set({ status: 'failed', error, runId })
    .where(eq(mailWorkerJobs.id, jobId))
}
