import webpush from 'web-push'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  mailAttachments,
  mailMessages,
  mailWorkerRuns,
  pushSubscriptions,
  resultDrafts,
  users,
} from '@kagetra/shared/schema'
import { getDb } from '../db.js'
import type { WebPushConfig } from '../config.js'
import type { PipelineLogger } from '../pipeline.js'
import { readExcel } from './reader.js'
import { parseResultExcel, PARSER_VERSION } from './parser.js'
import type { ParsedResultPayload } from './schema.js'

const NOOP_LOGGER: PipelineLogger = { info: () => undefined, warn: () => undefined }

export interface ResultParseResult {
  runId: number
  status: 'success' | 'parse_failed'
  draftId: number
}

/**
 * tournament-results Task3: result_parse ジョブハンドラ。
 *
 * 1. mail_attachments から添付バイト列を取得し readExcel + parseResultExcel で構造化。
 * 2. result_drafts を UPSERT（pending_review / parse_failed）。
 *    - 既存 draft が approved/rejected の場合は throw せず別ドラフトを作れるようにする
 *      将来の訂正版フロー（Task4）のため、現 Task3 では terminal 状態への上書きを避け
 *      "既に確定済み" エラーを返す。
 * 3. mail_worker_runs 行を作成して start → finish を記録し run_id を返す。
 * 4. Web Push（best-effort）。
 */
export async function runResultParse(opts: {
  mailMessageId: number
  attachmentId: number
  triggeredByUserId: string
  webPushConfig: WebPushConfig | null
  logger?: PipelineLogger
}): Promise<ResultParseResult> {
  const db = getDb()
  const log = opts.logger ?? NOOP_LOGGER

  // Create run row to link the job result.
  const [runRow] = await db
    .insert(mailWorkerRuns)
    .values({
      startedAt: sql`now()`,
      kind: 'manual',
      status: 'running',
      triggeredByUserId: opts.triggeredByUserId,
      since: null,
    })
    .returning({ id: mailWorkerRuns.id })
  const runId = runRow!.id

  let parseStatus: 'success' | 'parse_failed' = 'success'
  let parseError: string | null = null
  let payload: ParsedResultPayload = { parserVersion: PARSER_VERSION, classes: [] }
  let draftId: number = 0

  try {
    // 1. Read attachment bytes from DB.
    const att = await db
      .select({
        id: mailAttachments.id,
        mailMessageId: mailAttachments.mailMessageId,
        filename: mailAttachments.filename,
        data: mailAttachments.data,
      })
      .from(mailAttachments)
      .where(eq(mailAttachments.id, opts.attachmentId))
      .limit(1)

    if (att.length === 0) throw new Error(`attachment ${opts.attachmentId} not found`)
    const attachment = att[0]!

    // Verify the attachment belongs to the mail (security: prevent cross-mail access).
    if (attachment.mailMessageId !== opts.mailMessageId) {
      throw new Error(
        `attachment ${opts.attachmentId} does not belong to mail ${opts.mailMessageId}`,
      )
    }

    // 2. Parse Excel.
    let classes: ParsedResultPayload['classes']
    try {
      const sheets = await readExcel(attachment.data, attachment.filename)
      classes = parseResultExcel(sheets)
      if (classes.length === 0) {
        throw new Error(
          `パース結果が空でした（ヘッダ署名が見つかりません）: ${attachment.filename}`,
        )
      }
      payload = { parserVersion: PARSER_VERSION, classes }
      log.info('result_parse: parsed Excel', {
        mailMessageId: opts.mailMessageId,
        filename: attachment.filename,
        classCount: classes.length,
      })
    } catch (parseErr) {
      parseStatus = 'parse_failed'
      parseError = parseErr instanceof Error ? parseErr.message : String(parseErr)
      log.warn('result_parse: Excel parse failed', {
        mailMessageId: opts.mailMessageId,
        filename: attachment.filename,
        err: parseError,
      })
    }

    // 3. Upsert result_draft. ON CONFLICT (message_id):
    //    - If existing draft is approved/rejected → block re-parse (terminal state).
    //    - Otherwise → overwrite status/payload.
    const existingRows = await db
      .select({ id: resultDrafts.id, status: resultDrafts.status })
      .from(resultDrafts)
      .where(eq(resultDrafts.messageId, opts.mailMessageId))
      .limit(1)

    const existing = existingRows[0] ?? null

    if (existing && (existing.status === 'approved' || existing.status === 'rejected')) {
      // Protect terminal-state drafts from accidental overwrite.
      throw new Error(
        `result_draft for mail ${opts.mailMessageId} is already ${existing.status}`,
      )
    }

    if (existing) {
      // Overwrite non-terminal draft in-place (pending_review, parse_failed, superseded).
      const updated = await db
        .update(resultDrafts)
        .set({
          status: parseStatus === 'success' ? 'pending_review' : 'parse_failed',
          extractedPayload: parseStatus === 'success'
            ? (payload as unknown as Record<string, unknown>)
            : sql`'{}'::jsonb`,
          parserVersion: PARSER_VERSION,
          parseError,
          updatedAt: sql`now()`,
        })
        .where(eq(resultDrafts.id, existing.id))
        .returning({ id: resultDrafts.id })
      draftId = updated[0]!.id
    } else {
      // Fresh insert.
      const inserted = await db
        .insert(resultDrafts)
        .values({
          messageId: opts.mailMessageId,
          status: parseStatus === 'success' ? 'pending_review' : 'parse_failed',
          extractedPayload: parseStatus === 'success'
            ? (payload as unknown as Record<string, unknown>)
            : sql`'{}'::jsonb`,
          parserVersion: PARSER_VERSION,
          parseError,
        })
        .returning({ id: resultDrafts.id })
      draftId = inserted[0]!.id
    }

    log.info('result_parse: draft upserted', {
      mailMessageId: opts.mailMessageId,
      draftId,
      status: parseStatus,
    })
  } catch (err) {
    if (parseStatus === 'success') {
      // Fatal error before/after the parse step — treat as parse_failed.
      parseStatus = 'parse_failed'
      parseError = err instanceof Error ? err.message : String(err)
      log.warn('result_parse: top-level error', {
        mailMessageId: opts.mailMessageId,
        err: parseError,
      })
    }

    // If we haven't written a draft yet, create a parse_failed one.
    if (draftId === 0) {
      try {
        const existingRows2 = await db
          .select({ id: resultDrafts.id, status: resultDrafts.status })
          .from(resultDrafts)
          .where(eq(resultDrafts.messageId, opts.mailMessageId))
          .limit(1)
        const existing2 = existingRows2[0] ?? null

        if (existing2 && existing2.status !== 'approved' && existing2.status !== 'rejected') {
          const upd = await db
            .update(resultDrafts)
            .set({
              status: 'parse_failed',
              parseError,
              parserVersion: PARSER_VERSION,
              updatedAt: sql`now()`,
            })
            .where(eq(resultDrafts.id, existing2.id))
            .returning({ id: resultDrafts.id })
          draftId = upd[0]?.id ?? 0
        } else if (!existing2) {
          const ins = await db
            .insert(resultDrafts)
            .values({
              messageId: opts.mailMessageId,
              status: 'parse_failed',
              parserVersion: PARSER_VERSION,
              parseError,
            })
            .returning({ id: resultDrafts.id })
          draftId = ins[0]?.id ?? 0
        }
      } catch (draftErr) {
        log.warn('result_parse: fallback draft write failed', {
          mailMessageId: opts.mailMessageId,
          err: draftErr instanceof Error ? draftErr.message : String(draftErr),
        })
      }
    }
  }

  // 4. Finalize run row.
  const runFinalStatus = parseStatus === 'success' ? 'success' : 'ai_failed'
  await db
    .update(mailWorkerRuns)
    .set({
      finishedAt: sql`now()`,
      status: runFinalStatus,
      summary: {
        fetched: 0,
        classified: 0,
        drafts_created: parseStatus === 'success' ? 1 : 0,
        ai_failed: 0,
        imap_error: false,
        errors: parseError ? [parseError] : [],
        new_draft_subjects: [],
      },
      error: parseError,
    })
    .where(eq(mailWorkerRuns.id, runId))

  // 5. Web Push (best-effort).
  if (opts.webPushConfig) {
    try {
      await notifyResultParseCompleted(db, opts.webPushConfig, {
        mailMessageId: opts.mailMessageId,
        result: parseStatus,
      })
    } catch (pushErr) {
      log.warn('result_parse: web push failed', {
        runId,
        mailMessageId: opts.mailMessageId,
        err: pushErr instanceof Error ? pushErr.message : String(pushErr),
      })
    }
  }

  return { runId, status: parseStatus, draftId }
}

async function notifyResultParseCompleted(
  db: ReturnType<typeof getDb>,
  config: WebPushConfig,
  info: { mailMessageId: number; result: 'success' | 'parse_failed' },
): Promise<void> {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)

  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(ne(mailMessages.triageStatus, 'processed'))
  const badge = row?.value ?? 0

  const subs = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(pushSubscriptions.userId, users.id))
    .where(inArray(users.role, ['admin', 'vice_admin']))
  if (subs.length === 0) return

  const subjectRow = await db
    .select({ subject: mailMessages.subject })
    .from(mailMessages)
    .where(eq(mailMessages.id, info.mailMessageId))
    .limit(1)
  const subject = subjectRow[0]?.subject ?? '(件名なし)'

  const title = info.result === 'success' ? '結果取込完了' : '結果取込に失敗'
  const webPushPayload = JSON.stringify({
    title,
    body: subject.slice(0, 200),
    url: `/admin/mail-inbox/mail/${info.mailMessageId}`,
    badge,
  })

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        webPushPayload,
      )
    } catch {
      // best-effort: ignore individual delivery failures
    }
  }
}
