import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { mailWorkerJobs } from '@kagetra/shared/schema'
import type { Db } from './db.js'

/**
 * `mail_worker_jobs.kind` の TS リテラル型。enum は drizzle スキーマ側で
 * 'fetch' | 'manual_extract' を定義しており、dispatcher 分岐の identity と
 * して使う。
 *
 * - 'fetch'         : IMAP 取得 + persist のみ。AI 抽出は呼ばない（既存 cron）。
 * - 'manual_extract': inbox 詳細から「会で流す（AI 抽出）」を押した時の手動
 *                    AI ジョブ。`payload.mail_message_id` で対象を指定する。
 */
export type MailWorkerJobKind = 'fetch' | 'manual_extract'

export interface ManualExtractPayload {
  mail_message_id: number
}

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
  /** mail-inbox-mailer: ジョブ種別。`'fetch'` (IMAP) と `'manual_extract'` (AI 抽出) を識別。 */
  kind: MailWorkerJobKind
  /**
   * mail-inbox-mailer: kind 固有引数。`manual_extract` の場合は
   * `{ mail_message_id }` を含む。JSON 由来なので型は jsonb→unknown、
   * 呼び出し側で narrow する。
   */
  payload: unknown
}

export interface ClaimNextJobOptions {
  /**
   * mail-inbox-mailer: pick できるジョブ種別を絞る。指定しない場合は全種別を
   * 対象とする（既存呼び出しの互換）。dispatcher の mode (`--mode=extract-only`)
   * から `['manual_extract']` を渡して IMAP fetch ジョブを取らない。
   */
  kinds?: MailWorkerJobKind[]
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
 *
 * mail-inbox-mailer: 第 2 引数 `opts.kinds` で kind フィルタを掛けられる。
 * 未指定なら全種別。fetch mode は `['fetch']`、extract-only mode は
 * `['manual_extract']` を渡す想定。
 */
export async function claimNextJob(
  db: Db,
  opts: ClaimNextJobOptions = {},
): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mailWorkerJobs.id,
        requestedByUserId: mailWorkerJobs.requestedByUserId,
        since: mailWorkerJobs.since,
        requestedAt: mailWorkerJobs.requestedAt,
        kind: mailWorkerJobs.kind,
        payload: mailWorkerJobs.payload,
      })
      .from(mailWorkerJobs)
      .where(
        opts.kinds && opts.kinds.length > 0
          ? and(
              eq(mailWorkerJobs.status, 'pending'),
              inArray(mailWorkerJobs.kind, opts.kinds),
            )
          : eq(mailWorkerJobs.status, 'pending'),
      )
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
        kind: mailWorkerJobs.kind,
        payload: mailWorkerJobs.payload,
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
      kind: row.kind,
      payload: row.payload,
    }
  })
}

/**
 * mail-inbox-mailer: `manual_extract` ジョブの payload を narrow する。
 * jsonb から `mail_message_id: number` が取り出せなければ throw する。
 * dispatcher が claim 直後に呼ぶ薄いガード。
 */
export function parseManualExtractPayload(payload: unknown): ManualExtractPayload {
  if (
    payload &&
    typeof payload === 'object' &&
    'mail_message_id' in payload &&
    typeof (payload as { mail_message_id: unknown }).mail_message_id === 'number'
  ) {
    return { mail_message_id: (payload as { mail_message_id: number }).mail_message_id }
  }
  throw new Error(
    `manual_extract job payload missing mail_message_id (got ${JSON.stringify(payload)})`,
  )
}

/**
 * mail-inbox-mailer (Codex r8 should-fix): manual_extract は systemd 側の
 * TimeoutStartSec=300 (5 分) で SIGKILL されるので、fetch と同じ 1 時間閾値で
 * recover していると LLM/API ハング → kill 後に最大 1 時間 ai_processing が
 * 残ってしまう。extract-only mode 用に短い閾値（10 分）を別に用意する。
 */
export const STALE_CLAIM_RECOVERY_MS_EXTRACT = 10 * 60 * 1000 // 10 min

export interface RecoverStaleClaimedJobsOptions {
  /** stale 判定する経過 ms。未指定なら STALE_CLAIM_RECOVERY_MS（1 時間）。 */
  staleAfterMs?: number
  /** 復旧対象 kind を絞る。未指定なら全 kind を対象。 */
  kinds?: MailWorkerJobKind[]
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
 *
 * mail-inbox-mailer: 引数を options 化し kind フィルタと閾値を渡せるように
 * 拡張した。extract-only dispatcher は manual_extract だけを 10 分閾値で
 * 復旧し、fetch dispatcher は既定 1 時間 + 全 kind で復旧する。
 */
export async function recoverStaleClaimedJobs(
  db: Db,
  opts: RecoverStaleClaimedJobsOptions = {},
): Promise<number> {
  const staleAfterMs = opts.staleAfterMs ?? STALE_CLAIM_RECOVERY_MS
  const cutoff = new Date(Date.now() - staleAfterMs)
  const kinds = opts.kinds
  const recovered = await db
    .update(mailWorkerJobs)
    .set({ status: 'pending', claimedAt: null })
    .where(
      kinds && kinds.length > 0
        ? and(
            eq(mailWorkerJobs.status, 'claimed'),
            isNotNull(mailWorkerJobs.claimedAt),
            lt(mailWorkerJobs.claimedAt, cutoff),
            inArray(mailWorkerJobs.kind, kinds),
          )
        : and(
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
