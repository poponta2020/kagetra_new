import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  mailWorkerJobKindEnum,
  mailWorkerJobStatusEnum,
  mailWorkerRunKindEnum,
  mailWorkerRunStatusEnum,
} from './enums'
import { users } from './auth'

/**
 * mail_worker_runs: one row per mail-worker invocation (cron or manual).
 *
 * Inserted with `status='running'` at the start of `runOnce` and updated to
 * the terminal status (`success` / `imap_failed` / `ai_failed` / `partial`)
 * when the pipeline finishes. `summary` is the JSON shape used by
 * `evaluateConsecutiveFailures` to detect IMAP/AI alert conditions.
 *
 * `triggered_by_user_id` is set only for `kind='manual'` runs (claimed from
 * `mail_worker_jobs`); cron runs leave it null.
 */
export const mailWorkerRuns = pgTable('mail_worker_runs', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { mode: 'date', withTimezone: true }),
  kind: mailWorkerRunKindEnum('kind').notNull(),
  status: mailWorkerRunStatusEnum('status').notNull().default('running'),
  summary: jsonb('summary'),
  error: text('error'),
  triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  since: timestamp('since', { mode: 'date', withTimezone: true }),
})

/**
 * mail_worker_jobs: queue of admin-requested mail-worker invocations.
 *
 * Server Action inserts a row with `status='pending'`; the mail-worker
 * dispatcher claims it via `FOR UPDATE SKIP LOCKED`, executes the job per
 * `kind`, then UPDATEs the job to `done`/`failed` with `run_id` set to the
 * created `mail_worker_runs.id`.
 *
 * `kind` identifies what to execute (mail-inbox-mailer):
 *   - 'fetch'           : IMAP fetch round (existing behaviour, default)
 *   - 'manual_extract'  : extract a specific mail with AI; payload required
 *
 * `payload` carries kind-specific arguments. For `manual_extract` it must be
 * `{ mail_message_id: number }`; for `fetch` it is unused (null).
 *
 * The `(status, requested_at)` index supports the dispatcher's "oldest pending
 * job first" claim query.
 */
export const mailWorkerJobs = pgTable(
  'mail_worker_jobs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    requestedAt: timestamp('requested_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    since: timestamp('since', { mode: 'date', withTimezone: true }),
    status: mailWorkerJobStatusEnum('status').notNull().default('pending'),
    // mail-inbox-mailer: DEFAULT 'fetch' で既存行/既存 INSERT は無変更。
    kind: mailWorkerJobKindEnum('kind').notNull().default('fetch'),
    // mail-inbox-mailer: manual_extract 用 `{ mail_message_id: number }`。
    // fetch ジョブでは null。
    payload: jsonb('payload'),
    claimedAt: timestamp('claimed_at', { mode: 'date', withTimezone: true }),
    runId: integer('run_id').references(() => mailWorkerRuns.id, { onDelete: 'set null' }),
    error: text('error'),
  },
  (table) => [
    index('idx_mail_worker_jobs_status_requested_at').on(table.status, table.requestedAt),
    // mail-inbox-mailer (Codex r5 should-fix): claimNextJob は status + kind で
    // pending job を絞るようになった。extract-only timer は 30 秒間隔でこの
    // クエリを叩くので、pending fetch ジョブが溜まると manual_extract の claim
    // が全表スキャンに近い実行計画になり、UI の体感速度を直接損なう。
    // status + kind + requested_at の複合 index を追加する。
    index('idx_mail_worker_jobs_status_kind_requested_at').on(
      table.status,
      table.kind,
      table.requestedAt,
    ),
  ],
)
