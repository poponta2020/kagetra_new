import { and, desc, eq } from 'drizzle-orm'
import { mailWorkerRuns } from '@kagetra/shared/schema'
import type { Db } from '../db.js'
import {
  LineNotifyError,
  type NotifyLogger,
  pushSystemNotification,
} from './line.js'
import { buildErrorMessage, buildNewDraftsMessage } from './message-templates.js'

/**
 * The persisted shape of `mail_worker_runs.summary`. Mirrors the doc-comment
 * in `pipeline.ts:runOnce` — kept here as a single source of truth so the
 * notify orchestrator and the pipeline writer can't drift.
 *
 * All numeric counters default to 0; flags default to absent (undefined). The
 * notification book-keeping flags (`notified_*_alert`) are written *after*
 * the run row exists so consecutive-failure logic can scan the previous
 * run's marker to suppress re-pings.
 */
export interface MailWorkerRunSummary {
  fetched: number
  classified: number
  drafts_created: number
  ai_failed: number
  imap_error: boolean
  errors: string[]
  notified_imap_alert?: true
  notified_ai_alert?: true
  new_draft_subjects?: string[]
}

/**
 * DI hook so tests can inject a `vi.fn()` instead of hitting the real LINE
 * SDK. Default is `pushSystemNotification` which goes through the SDK +
 * `LINE_NOTIFY_DRY_RUN` gating.
 */
export type Notifier = (
  db: Db,
  message: string,
  logger?: NotifyLogger,
) => Promise<unknown>

const NOOP_LOGGER: NotifyLogger = {
  info: () => undefined,
  warn: () => undefined,
}

const CONSECUTIVE_RUN_WINDOW = 3
const AI_FAILURE_THRESHOLD = 3

/**
 * After the pipeline finishes and the current run row is persisted, decide
 * whether to push notifications and update the run summary's
 * `notified_*_alert` markers.
 *
 * Three independent triggers, each gated to avoid spam:
 *
 *   1. **New drafts**: any positive `drafts_created` count → one push per
 *      run with the top-5 subjects.
 *   2. **IMAP consecutive failures**: 3 consecutive runs (including current)
 *      with `imap_error=true`. Suppressed if the previous run already pinged
 *      (`notified_imap_alert=true`). After pushing, the current run's
 *      summary is patched to set `notified_imap_alert=true`.
 *   3. **AI consecutive failures**: cumulative `ai_failed` >= 3 across the
 *      last 3 runs. Same suppression / marker pattern.
 *
 * Notification SDK throws (`LineNotifyError`) are caught here and logged —
 * a transient LINE outage must not roll back the pipeline run that already
 * persisted drafts.
 */
export async function evaluateAndNotify(
  db: Db,
  runId: number,
  logger: NotifyLogger = NOOP_LOGGER,
  notifier: Notifier = pushSystemNotification,
): Promise<void> {
  const recent = await fetchRecentRuns(db, CONSECUTIVE_RUN_WINDOW)
  const current = recent.find((r) => r.id === runId)
  if (!current) {
    // Defensive: a concurrent run delete shouldn't crash notify. Just bail.
    logger.warn('evaluateAndNotify: current run not found in recent window', {
      runId,
    })
    return
  }
  const currentSummary = (current.summary ?? {}) as MailWorkerRunSummary

  // (1) New drafts. Always notify when drafts_created > 0, even if the
  // post-hoc subject lookup came back empty — losing a subject preview is far
  // worse than silently dropping the alert. `totalCount` is the canonical
  // count from the run summary; subjects are a preview list (top-N).
  const draftsCreated = currentSummary.drafts_created ?? 0
  if (draftsCreated > 0) {
    const subjects = currentSummary.new_draft_subjects ?? []
    await safeNotify(notifier, db, buildNewDraftsMessage({
      totalCount: draftsCreated,
      previewSubjects: subjects,
    }), logger)
  }

  // (2) IMAP consecutive failures.
  const previous = recent.find((r) => r.id !== runId)
  const prevSummary = previous
    ? ((previous.summary ?? {}) as MailWorkerRunSummary)
    : null

  if (
    recent.length >= CONSECUTIVE_RUN_WINDOW &&
    recent.every((r) => ((r.summary ?? {}) as MailWorkerRunSummary).imap_error === true) &&
    !(prevSummary?.notified_imap_alert === true)
  ) {
    const lastError = currentSummary.errors?.[0] ?? 'unknown IMAP error'
    const sent = await safeNotify(
      notifier,
      db,
      buildErrorMessage({
        kind: 'imap',
        recentRuns: CONSECUTIVE_RUN_WINDOW,
        lastError,
      }),
      logger,
    )
    if (sent) {
      await markAlertNotified(db, runId, currentSummary, 'imap')
    }
  }

  // (3) AI consecutive failures. Two conditions, both required:
  //   a. Every run in the recent window has `ai_failed > 0` — i.e. the failure
  //      is *consecutive*, not a single bad batch (review r1: pre-fix,
  //      `[0, 0, 3]` would also pinned the alert).
  //   b. Cumulative `ai_failed` across the window meets the threshold.
  // (a) alone is not enough: 3 runs with `ai_failed=1` each (3 mails total)
  // is enough signal to alert; (b) alone is not enough: a single batch with
  // ai_failed=3 isn't a consecutive failure.
  const recentSummaries = recent.map(
    (r) => (r.summary ?? {}) as MailWorkerRunSummary,
  )
  const aiFailedCumulative = recentSummaries.reduce(
    (acc, s) => acc + (s.ai_failed ?? 0),
    0,
  )
  const aiFailedEveryRun = recentSummaries.every((s) => (s.ai_failed ?? 0) > 0)
  if (
    recent.length >= CONSECUTIVE_RUN_WINDOW &&
    aiFailedEveryRun &&
    aiFailedCumulative >= AI_FAILURE_THRESHOLD &&
    !(prevSummary?.notified_ai_alert === true)
  ) {
    // Pull the last AI error string from the most recent run that had AI
    // failures (current first, then walk back). Falls back to a generic
    // string if all errors arrays are empty.
    let lastError = 'unknown AI error'
    for (const r of recent) {
      const s = (r.summary ?? {}) as MailWorkerRunSummary
      if ((s.ai_failed ?? 0) > 0 && s.errors && s.errors.length > 0) {
        lastError = s.errors[s.errors.length - 1] ?? lastError
        break
      }
    }
    const sent = await safeNotify(
      notifier,
      db,
      buildErrorMessage({
        kind: 'ai',
        recentRuns: aiFailedCumulative,
        lastError,
      }),
      logger,
    )
    if (sent) {
      await markAlertNotified(db, runId, currentSummary, 'ai')
    }
  }
}

async function fetchRecentRuns(db: Db, limit: number) {
  return db
    .select({
      id: mailWorkerRuns.id,
      summary: mailWorkerRuns.summary,
      status: mailWorkerRuns.status,
      startedAt: mailWorkerRuns.startedAt,
    })
    .from(mailWorkerRuns)
    .orderBy(desc(mailWorkerRuns.startedAt))
    .limit(limit)
}

async function safeNotify(
  notifier: Notifier,
  db: Db,
  message: string,
  logger: NotifyLogger,
): Promise<boolean> {
  try {
    await notifier(db, message, logger)
    return true
  } catch (err) {
    if (err instanceof LineNotifyError) {
      logger.warn('LINE notify failed; pipeline continues', {
        message: err.message,
        cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
      })
      return false
    }
    // Non-LineNotifyError surface (e.g. system channel not configured) is
    // also caught here — the pipeline must not abort because LINE is not
    // wired yet. Log loudly so operators notice.
    logger.warn('notifier threw unexpectedly; pipeline continues', {
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

async function markAlertNotified(
  db: Db,
  runId: number,
  currentSummary: MailWorkerRunSummary,
  kind: 'imap' | 'ai',
): Promise<void> {
  const next: MailWorkerRunSummary = {
    ...currentSummary,
    ...(kind === 'imap'
      ? { notified_imap_alert: true as const }
      : { notified_ai_alert: true as const }),
  }
  await db
    .update(mailWorkerRuns)
    .set({ summary: next })
    .where(and(eq(mailWorkerRuns.id, runId)))
}
