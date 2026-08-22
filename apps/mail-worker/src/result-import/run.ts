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
import { loadCostGuardConfig, type WebPushConfig } from '../config.js'
import type { PipelineLogger } from '../pipeline.js'
import { readExcel } from './reader.js'
import type { CellGrid, SheetData } from './reader.js'
import { parseResultExcel, PARSER_VERSION } from './parser.js'
import type { ParsedResultPayload } from './schema.js'
import { applyClassMap, AiValidationError, PROMPT_VERSION } from './ai/index.js'
import type { ExtractionSource, ResultImportAi } from './ai/index.js'

const NOOP_LOGGER: PipelineLogger = { info: () => undefined, warn: () => undefined }

/**
 * Draft statuses a result_parse run may overwrite. Mirrors triggerResultParse:
 * approved / pending_review are protected, everything else is re-importable.
 */
const OVERWRITABLE_DRAFT_STATUSES = ['parse_failed', 'rejected', 'superseded'] as const

export interface ResultParseResult {
  runId: number
  status: 'success' | 'parse_failed'
  draftId: number
}

/**
 * Minimal CSV serialization for an Excel sheet grid, used to hand a
 * spreadsheet to the AI full-extraction call as plain text. Only quotes a
 * cell when it contains a comma, quote, or newline (RFC 4180 minimal form) —
 * no header row, no type coercion beyond what `readExcel` already did.
 */
function csvEscapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

function gridToCsv(grid: CellGrid): string {
  return grid.map((row) => row.map((cell) => csvEscapeCell(cell ?? '')).join(',')).join('\n')
}

/**
 * tournament-results Task3: result_parse ジョブハンドラ。
 *
 * 1. mail_attachments から添付バイト列を取得。
 * 2. Excel は readExcel + parseResultExcel で決定的パースを試みる（PDF はスキップ）。
 * 2b. `opts.ai` が指定されていれば AI ルーティング/フル抽出を組み込む
 *     （tournament-results AI revamp）: 決定的パースが 1 クラス以上あれば
 *     ルーティングで採否判定 → adopt は classMap 適用・escalate はフル抽出。
 *     0 クラス・PDF はルーティングを飛ばしフル抽出へ直行。AI 呼び出しの例外は
 *     fail-open（決定的パース結果があればそれを採用して続行、無ければ
 *     parse_failed）。`AiValidationError` だけは常に parse_failed。
 * 3. result_drafts を UPSERT（pending_review / parse_failed）。
 *    - 既存 draft が approved/rejected の場合は throw せず別ドラフトを作れるようにする
 *      将来の訂正版フロー（Task4）のため、現 Task3 では terminal 状態への上書きを避け
 *      "既に確定済み" エラーを返す。
 * 4. mail_worker_runs 行を作成して start → finish を記録し run_id を返す。
 * 5. Web Push（best-effort）。
 */
export async function runResultParse(opts: {
  mailMessageId: number
  attachmentId: number
  triggeredByUserId: string
  webPushConfig: WebPushConfig | null
  logger?: PipelineLogger
  ai?: ResultImportAi
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

  // AI ルーティング/フル抽出の所見（tournament-results AI revamp, Task3）。
  // `opts.ai` が未指定なら全て null のまま — result_drafts の ai_* 列を
  // 明示的に null 上書きし、再取込で古い所見が残らないようにする。
  let aiRoutingJson: unknown = null
  let aiModelUsed: string | null = null
  let aiPromptVersionUsed: string | null = null
  let aiTokensInputSum = 0
  let aiTokensOutputSum = 0
  let aiCostSum = 0
  let aiErrorMsg: string | null = null
  let extractionSource: 'parser' | 'ai' | null = null

  // Shared AI-column payload for all three result_drafts write sites (fresh
  // insert / re-import update / catch-block fallback). Reads the outer-scoped
  // `ai*` vars by closure so every write site — including the one reached
  // after a top-level throw — reflects however far the AI phase got.
  const buildAiWriteFields = () => ({
    // jsonb column insert type is `Record<string, unknown> | null` — cast
    // through `unknown` like `extractedPayload` below (TS: an interface
    // without an index signature isn't directly assignable to
    // `Record<string, unknown>`; `aiRoutingJson` is already `unknown` so a
    // single assertion suffices here).
    aiRouting: aiRoutingJson as Record<string, unknown> | null,
    aiModel: aiModelUsed,
    aiPromptVersion: aiPromptVersionUsed,
    aiTokensInput: aiModelUsed ? aiTokensInputSum : null,
    aiTokensOutput: aiModelUsed ? aiTokensOutputSum : null,
    aiCostUsd: aiModelUsed ? aiCostSum.toFixed(6) : null,
    aiError: aiErrorMsg,
    extractionSource,
  })

  try {
    // 1. Read attachment bytes from DB.
    const att = await db
      .select({
        id: mailAttachments.id,
        mailMessageId: mailAttachments.mailMessageId,
        filename: mailAttachments.filename,
        data: mailAttachments.data,
        sizeBytes: mailAttachments.sizeBytes,
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

    // 2. Determine attachment kind. PDF check MUST come before readExcel /
    //    detectExcelFormat — the latter throws on a `.pdf` filename, which
    //    would otherwise be caught below and misreported as a parse failure.
    const isPdf = attachment.filename.toLowerCase().endsWith('.pdf')

    // 2a. Deterministic Excel parse (skipped for PDF — no spreadsheet to read).
    let classes: ParsedResultPayload['classes'] = []
    let sheets: SheetData[] = []
    let deterministicError: string | null = null
    // Distinguishes "readExcel itself threw" (nothing to hand to AI full
    // extraction — sheets stays []) from "sheets read fine but the parser
    // found 0 classes" (sheets has real content, safe to send to AI). See 2b.
    let sheetsRead = false
    if (!isPdf) {
      try {
        sheets = await readExcel(attachment.data, attachment.filename)
        sheetsRead = true
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
        deterministicError = parseErr instanceof Error ? parseErr.message : String(parseErr)
        log.warn('result_parse: Excel parse failed', {
          mailMessageId: opts.mailMessageId,
          filename: attachment.filename,
          err: deterministicError,
        })
        if (!opts.ai) {
          // No AI configured — mirror the pre-AI behaviour exactly.
          parseStatus = 'parse_failed'
          parseError = deterministicError
        }
      }
    } else if (!opts.ai) {
      parseStatus = 'parse_failed'
      parseError = 'PDF の取込には AI 抽出が必要です'
    }

    // 2b. AI routing / full extraction (tournament-results AI revamp).
    if (opts.ai) {
      const ai = opts.ai
      const hasDeterministicClasses = !isPdf && classes.length > 0
      // We attempted an AI call (even if it fails or is guard-rejected before
      // ever reaching the model) — record model/prompt version regardless of
      // outcome so `ai_error`-flagged rows are still attributable.
      aiModelUsed = ai.modelId
      aiPromptVersionUsed = PROMPT_VERSION

      let subject = ''
      try {
        const subjRows = await db
          .select({ subject: mailMessages.subject })
          .from(mailMessages)
          .where(eq(mailMessages.id, opts.mailMessageId))
          .limit(1)
        subject = subjRows[0]?.subject ?? ''
      } catch {
        subject = ''
      }

      const buildSheetsSource = (): ExtractionSource => ({
        kind: 'sheets',
        sheets: sheets.map((s) => ({ name: s.name, csv: gridToCsv(s.grid) })),
      })

      // Distinguishes an `AiValidationError` thrown by `ai.extract()` (must
      // always become parse_failed, AC-8) from one thrown by `ai.route()`
      // (a routing-side schema mismatch — nothing derived from it becomes
      // payload, so it's just another AI-call failure and should fail-open
      // like any other exception). `AiValidationError` is documented as
      // coming from either call (`ai/types.ts`), so the class alone can't
      // disambiguate — this flag can.
      let extractionCallStarted = false
      const runFullExtraction = async (source: ExtractionSource) => {
        extractionCallStarted = true
        const extraction = await ai.extract({
          filename: attachment.filename,
          subject,
          promptVersion: PROMPT_VERSION,
          source,
        })
        aiTokensInputSum += extraction.tokensInput
        aiTokensOutputSum += extraction.tokensOutput
        aiCostSum += extraction.costUsd
        extractionSource = 'ai'
        if (extraction.parsed.classes.length === 0) {
          // Schema-valid but empty — a 0-class draft renders an approval
          // screen with a permanently disabled button and no way to fix it.
          // Never let an empty AI payload through as a "success" draft.
          parseStatus = 'parse_failed'
          parseError = 'AI 抽出の結果に取り込める級がありませんでした'
        } else {
          payload = extraction.parsed
          parseStatus = 'success'
          parseError = null
        }
      }

      try {
        if (isPdf) {
          // Guard on `sizeBytes` (the canonical original-buffer length), not
          // `attachment.data.length` — the bytea round-trip can hand back a
          // postgres hex-escape string whose `.length` over-reports by ~2x
          // (same rationale as classify/classifier.ts's oversize_skipped
          // guard).
          const limitKb = loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB
          if (limitKb > 0 && attachment.sizeBytes > limitKb * 1024) {
            throw new Error(
              `PDF サイズが上限（${limitKb}KB）を超えています（${Math.ceil(attachment.sizeBytes / 1024)}KB）`,
            )
          }
          await runFullExtraction({ kind: 'pdf', base64: attachment.data.toString('base64') })
          log.info('result_parse: AI full extraction from PDF', {
            mailMessageId: opts.mailMessageId,
            filename: attachment.filename,
          })
        } else if (classes.length === 0 && !sheetsRead) {
          // readExcel itself failed — sheets is empty, not just "0 classes
          // parsed". Sending an empty { kind: 'sheets', sheets: [] } to AI
          // full extraction can't recover the data; treat it as a parse
          // failure with the original read error instead.
          parseStatus = 'parse_failed'
          parseError = deterministicError
          log.warn('result_parse: Excel read failed — skipping AI full extraction', {
            mailMessageId: opts.mailMessageId,
            filename: attachment.filename,
            err: deterministicError,
          })
        } else if (classes.length === 0) {
          log.info('result_parse: no deterministic classes — running AI full extraction', {
            mailMessageId: opts.mailMessageId,
            filename: attachment.filename,
          })
          await runFullExtraction(buildSheetsSource())
        } else {
          const routing = await ai.route({
            filename: attachment.filename,
            subject,
            sheetNames: sheets.map((s) => s.name),
            sheetHeadRows: sheets.map((s) => ({
              sheetName: s.name,
              rows: s.grid.slice(0, 5).map((row) => row.map((cell) => cell ?? '')),
            })),
            parserAttempt: classes.map((c) => ({
              className: c.className,
              participantCount: c.participants.length,
            })),
            promptVersion: PROMPT_VERSION,
          })
          aiTokensInputSum += routing.tokensInput
          aiTokensOutputSum += routing.tokensOutput
          aiCostSum += routing.costUsd
          aiRoutingJson = routing.parsed
          log.info('result_parse: AI routing verdict', {
            mailMessageId: opts.mailMessageId,
            verdict: routing.parsed.verdict,
          })

          if (routing.parsed.verdict === 'adopt') {
            payload = applyClassMap(payload, routing.parsed.classMap)
            extractionSource = 'parser'
            if (payload.classes.length === 0) {
              // The classMap excluded every parsed class (e.g. the only sheet
              // was 選手一覧). `adopt` + "nothing left" is the model
              // contradicting itself, and an empty payload would sail through
              // as pending_review and render an approval screen with no rows
              // and a permanently disabled button. Escalate instead — this is
              // exactly the shape where the real results live in a sheet the
              // deterministic parser mis-titled.
              log.warn('result_parse: classMap excluded every class — escalating to full extraction', {
                mailMessageId: opts.mailMessageId,
              })
              await runFullExtraction(buildSheetsSource())
            }
          } else if (routing.parsed.verdict === 'escalate') {
            log.info('result_parse: AI escalate — running full extraction', {
              mailMessageId: opts.mailMessageId,
            })
            await runFullExtraction(buildSheetsSource())
          } else {
            // out_of_scope: keep the deterministic payload (classMap may still
            // apply normalization); the warning banner is the approval
            // screen's responsibility, driven by ai_routing.verdict.
            payload = applyClassMap(payload, routing.parsed.classMap)
            extractionSource = 'parser'
            log.warn('result_parse: AI routing verdict=out_of_scope', {
              mailMessageId: opts.mailMessageId,
              outOfScopeKind: routing.parsed.outOfScopeKind,
            })
            if (payload.classes.length === 0) {
              // 対象外判定 + 取り込める級ゼロ。フル抽出に回してもコストを払って
              // 名簿を書き写すだけなので、ここで打ち切って理由を残す（空 payload の
              // まま pending_review にすると承認画面が操作不能になる）。
              parseStatus = 'parse_failed'
              parseError =
                'AI が対象外（団体戦・名簿・抽選結果など）と判定し、取り込める級がありませんでした'
            }
          }
        }
      } catch (err) {
        if (err instanceof AiValidationError && extractionCallStarted) {
          // Never surface unvalidated full-extraction output for approval
          // (AC-8). A validation error from `ai.route()` instead falls
          // through to the generic fail-open branch below — nothing from
          // routing ever becomes payload, so it's not an "unvalidated data"
          // risk the way a bad extraction result would be.
          parseStatus = 'parse_failed'
          aiErrorMsg = err.message
          parseError = `AI抽出データの検証に失敗しました: ${err.message}`
          log.warn('result_parse: AI extraction failed validation', {
            mailMessageId: opts.mailMessageId,
            err: err.message,
          })
        } else {
          aiErrorMsg = err instanceof Error ? err.message : String(err)
          if (hasDeterministicClasses) {
            // fail-open: keep the deterministic payload/pending_review.
            parseStatus = 'success'
            parseError = null
            extractionSource = 'parser'
            log.warn('result_parse: AI call failed — fail-open to deterministic parse', {
              mailMessageId: opts.mailMessageId,
              err: aiErrorMsg,
            })
          } else {
            parseStatus = 'parse_failed'
            parseError = isPdf
              ? `PDF の取込には AI 抽出が必要ですが失敗しました: ${aiErrorMsg}`
              : (deterministicError ?? aiErrorMsg)
            log.warn('result_parse: AI call failed with no deterministic fallback', {
              mailMessageId: opts.mailMessageId,
              err: aiErrorMsg,
            })
          }
        }
      }
    }

    // 3. Upsert result_draft by message_id. The draft-state policy MUST match
    //    triggerResultParse (Codex R1 blocker: worker and Server Action
    //    disagreed). The Server Action blocks queueing when a draft is approved
    //    or pending_review and allows re-import for parse_failed / rejected /
    //    superseded. The worker mirrors that and additionally guards races /
    //    stale jobs:
    //      - approved / pending_review        → never overwrite (skip, keep existing)
    //      - parse_failed/rejected/superseded → overwrite in place (status-guarded)
    //      - none                             → insert
    const existingRows = await db
      .select({ id: resultDrafts.id, status: resultDrafts.status })
      .from(resultDrafts)
      .where(eq(resultDrafts.messageId, opts.mailMessageId))
      .limit(1)

    const existing = existingRows[0] ?? null

    if (existing && (existing.status === 'approved' || existing.status === 'pending_review')) {
      // A draft is already finalized or awaiting operator review — do not
      // clobber it. triggerResultParse blocks queueing in these states; this
      // covers a race (two jobs queued before either ran) or a stale job.
      log.info('result_parse: existing draft is approved/pending_review — skipping overwrite', {
        mailMessageId: opts.mailMessageId,
        draftId: existing.id,
        status: existing.status,
      })
      draftId = existing.id
    } else if (existing) {
      // Re-import overwrites a re-importable draft in place. The status guard in
      // WHERE prevents a stale job from clobbering a draft that raced into
      // pending_review/approved between our SELECT and this UPDATE.
      const updated = await db
        .update(resultDrafts)
        .set({
          status: parseStatus === 'success' ? 'pending_review' : 'parse_failed',
          extractedPayload: parseStatus === 'success'
            ? (payload as unknown as Record<string, unknown>)
            : sql`'{}'::jsonb`,
          // AI full extraction stamps its own `payload.parserVersion`
          // (`ai-extract-<PROMPT_VERSION>`, see ai/anthropic.ts) so the
          // column stays in sync with the payload's declared provenance
          // instead of always claiming the deterministic parser (AC-9). On
          // the deterministic-only path `payload.parserVersion` already
          // equals `PARSER_VERSION`, so this is a no-op there.
          parserVersion: parseStatus === 'success' ? payload.parserVersion : PARSER_VERSION,
          parseError,
          ...buildAiWriteFields(),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(resultDrafts.id, existing.id),
            inArray(resultDrafts.status, [...OVERWRITABLE_DRAFT_STATUSES]),
          ),
        )
        .returning({ id: resultDrafts.id })
      if (updated.length === 0) {
        // Status changed under us (race) — leave the winner's draft intact.
        log.warn('result_parse: draft status changed before overwrite — skipping', {
          mailMessageId: opts.mailMessageId,
          draftId: existing.id,
        })
        draftId = existing.id
      } else {
        draftId = updated[0]!.id
      }
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
          // See the parallel comment on the update branch above.
          parserVersion: parseStatus === 'success' ? payload.parserVersion : PARSER_VERSION,
          parseError,
          ...buildAiWriteFields(),
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

    // If we haven't written a draft yet, create a parse_failed one — but honor
    // the same state policy as the success path: never clobber an approved or
    // pending_review draft, only overwrite a re-importable one (status-guarded).
    if (draftId === 0) {
      try {
        const existingRows2 = await db
          .select({ id: resultDrafts.id, status: resultDrafts.status })
          .from(resultDrafts)
          .where(eq(resultDrafts.messageId, opts.mailMessageId))
          .limit(1)
        const existing2 = existingRows2[0] ?? null

        if (!existing2) {
          const ins = await db
            .insert(resultDrafts)
            .values({
              messageId: opts.mailMessageId,
              status: 'parse_failed',
              parserVersion: PARSER_VERSION,
              parseError,
              ...buildAiWriteFields(),
            })
            .returning({ id: resultDrafts.id })
          draftId = ins[0]?.id ?? 0
        } else {
          // Overwrite only a re-importable draft to parse_failed; leave
          // approved/pending_review intact.
          const upd = await db
            .update(resultDrafts)
            .set({
              status: 'parse_failed',
              // Reset payload so a fatal re-import (e.g. attachment missing /
              // cross-mail) doesn't leave a stale preview on a parse_failed
              // draft — mirrors the normal parse_failed path (Codex R3 should_fix).
              extractedPayload: sql`'{}'::jsonb`,
              parseError,
              parserVersion: PARSER_VERSION,
              ...buildAiWriteFields(),
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(resultDrafts.id, existing2.id),
                inArray(resultDrafts.status, [...OVERWRITABLE_DRAFT_STATUSES]),
              ),
            )
            .returning({ id: resultDrafts.id })
          draftId = upd[0]?.id ?? existing2.id
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
