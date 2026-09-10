#!/usr/bin/env tsx
/**
 * Daily batch for annual-registration-renewal (年度確認):
 *
 *   --reminders           19:30 JST — ① `reconcileTasks`（`RESERVING` 滞留 →
 *                          `MANUAL_REVIEW_REQUIRED`、期限切れ `PENDING` → `FAILED`）
 *                          ② 当日ぶんのリマインドタスク作成
 *                          （`createReminderTasksForToday`）
 *   --apply-school-year   00:05 JST — 4/1（JST）以降の学年回答を `users` へ反映
 *                          （`applySchoolYearForToday`）
 *
 * 両方を同時に指定してもよい（`--reminders --apply-school-year`）。
 *
 * 冪等性: `--reminders` は `(renewal, kind='reminder', target_date)` の未取消行が
 * あれば作り直さない（同日再実行が安全）。`--apply-school-year` は
 * `school_year_applied_at IS NULL` を鍵にした CAS で二重反映を防ぐ。
 *
 * `--dry-run` は候補を列挙するだけで、タスク作成・LINE API 呼び出し・`users` の
 * 更新のいずれも行わない（send-entry-overdue-alert.ts / send-lifecycle-reminders.ts
 * と同じ方針）。
 *
 * Usage:
 *   DATABASE_URL=postgres://... PUBLIC_BASE_URL=https://... \
 *     pnpm --filter @kagetra/web exec tsx scripts/renewal-daily.ts --reminders [--dry-run]
 *   DATABASE_URL=postgres://... \
 *     pnpm --filter @kagetra/web exec tsx scripts/renewal-daily.ts --apply-school-year [--dry-run]
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { db } from '@/lib/db'
import { notifyRenewalAdmin, reconcileTasks } from '@/lib/line-chat-tasks'
import {
  createReminderTasksForToday,
  previewReminderCandidates,
} from '@/lib/membership-renewal/reminders'
import {
  applySchoolYearForToday,
  previewSchoolYearApply,
} from '@/lib/membership-renewal/apply-school-year'

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

function buildLogger(prefix: string): Logger {
  return {
    info: (msg, ctx) =>
      process.stdout.write(`[${prefix}] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
    warn: (msg, ctx) =>
      process.stderr.write(`[${prefix}] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
  }
}

/** reconcile の滞留・期限切れ件数を管理者個人 LINE へ知らせる文面（R13）。 */
function buildReconcileNotificationText(result: {
  staleReserving: number
  expiredPending: number
}): string {
  const lines = ['【年度確認】LINE 送信タスクの要確認・失敗があります']
  if (result.staleReserving > 0) lines.push(`要確認（予約が滞留）: ${result.staleReserving}件`)
  if (result.expiredPending > 0) lines.push(`失敗（期限切れ・未予約）: ${result.expiredPending}件`)
  lines.push('設定 › 会 LINE グループ で状態を確認してください。')
  return lines.join('\n')
}

/**
 * `--reminders`（① reconcile → ② リマインド作成）。`--dry-run` は
 * `previewReminderCandidates` を呼ぶだけで、reconcile もタスク作成も行わない
 * （副作用ゼロで候補を確認できる）。
 */
export async function runReminders(
  opts: { now?: Date; dryRun?: boolean; logger?: Logger } = {},
): Promise<void> {
  const now = opts.now ?? new Date()
  const logger = opts.logger ?? buildLogger('renewal-daily reminders')

  if (opts.dryRun) {
    const preview = await previewReminderCandidates({ now })
    process.stdout.write(`[renewal-daily reminders] DRY RUN (now=${now.toISOString()})\n`)
    if ('skipped' in preview) {
      process.stdout.write(`  skipped: ${preview.skipped}\n`)
      return
    }
    process.stdout.write(
      `  renewalId=${preview.renewalId} targetDate=${preview.targetDate} ` +
        `unanswered=${preview.unansweredCount} splitCount=${preview.splitCount}\n`,
    )
    for (const message of preview.messages) {
      process.stdout.write(`  ---\n  ${message}\n`)
    }
    return
  }

  const reconcileResult = await reconcileTasks(db, now)
  if (reconcileResult.staleReserving > 0 || reconcileResult.expiredPending > 0) {
    logger.warn('reconcile: found stale/expired tasks', { ...reconcileResult })
    await notifyRenewalAdmin(db, buildReconcileNotificationText(reconcileResult), { logger })
  } else {
    logger.info('reconcile: no stale/expired tasks', { ...reconcileResult })
  }

  const result = await createReminderTasksForToday({ now, logger })
  if ('skipped' in result) {
    logger.info(`reminders: skipped (${result.skipped})`)
  } else {
    logger.info('reminders: created', result)
  }
}

/**
 * `--apply-school-year`。`--dry-run` は `previewSchoolYearApply` を呼ぶだけで、
 * `users`／`membership_renewal_members` への書き込みを行わない。
 */
export async function runApplySchoolYear(
  opts: { now?: Date; dryRun?: boolean; logger?: Logger } = {},
): Promise<void> {
  const now = opts.now ?? new Date()
  const logger = opts.logger ?? buildLogger('renewal-daily apply-school-year')

  if (opts.dryRun) {
    const preview = await previewSchoolYearApply({ now })
    process.stdout.write(
      `[renewal-daily apply-school-year] DRY RUN (now=${now.toISOString()}): ` +
        `${preview.length} candidate(s)\n`,
    )
    for (const candidate of preview) {
      process.stdout.write(`  - user ${candidate.userId} (fiscalYear=${candidate.fiscalYear})\n`)
    }
    return
  }

  const result = await applySchoolYearForToday({ now, logger })
  logger.info('apply-school-year: done', { ...result })
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const isDryRun = argv.includes('--dry-run')
  const runRemindersFlag = argv.includes('--reminders')
  const runApplySchoolYearFlag = argv.includes('--apply-school-year')
  if (!runRemindersFlag && !runApplySchoolYearFlag) {
    throw new Error(
      'renewal-daily: --reminders または --apply-school-year のいずれかを指定してください',
    )
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set')

  if (runRemindersFlag) await runReminders({ dryRun: isDryRun })
  if (runApplySchoolYearFlag) await runApplySchoolYear({ dryRun: isDryRun })
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(
        `[renewal-daily] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
