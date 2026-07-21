import { and, eq, sql } from 'drizzle-orm'
import {
  mailAttachments,
  mailMessages,
  mailWorkerRuns,
  tournamentRosterImportDrafts,
} from '@kagetra/shared/schema'
import { getDb, type DbClient } from '../db.js'
import type { PipelineLogger } from '../pipeline.js'
import { readExcel } from '../result-import/reader.js'
import { classifyRosterCandidate } from './candidate.js'
import { parseRosterGrid } from './parser.js'

export const ROSTER_PARSER_VERSION = 'roster-deterministic-v1'

const NOOP_LOGGER: PipelineLogger = { info: () => undefined, warn: () => undefined }

export interface RosterParseResult {
  runId: number
  draftId: number
  status: 'pending_review' | 'parse_failed'
  created: boolean
}

interface RosterDraftParseOutcome {
  status: RosterParseResult['status']
  payload: Record<string, unknown>
  failureReason: string | null
}

export async function runRosterParse(opts: {
  mailMessageId: number
  attachmentId?: number | null
  triggeredByUserId: string | null
  logger?: PipelineLogger
  db?: DbClient
}): Promise<RosterParseResult> {
  const db = opts.db ?? getDb()
  const log = opts.logger ?? NOOP_LOGGER
  const [run] = await db.insert(mailWorkerRuns).values({
    startedAt: sql`now()`,
    kind: 'manual',
    status: 'running',
    triggeredByUserId: opts.triggeredByUserId,
    since: null,
  }).returning({ id: mailWorkerRuns.id })
  const runId = run!.id

  let result: RosterParseResult | null = null
  let runError: string | null = null
  try {
    const [message] = await db.select({
      id: mailMessages.id,
      subject: mailMessages.subject,
      bodyText: mailMessages.bodyText,
      receivedAt: mailMessages.receivedAt,
    }).from(mailMessages).where(eq(mailMessages.id, opts.mailMessageId)).limit(1)
    if (!message) throw new Error(`mail message ${opts.mailMessageId} not found`)

    const attachment = opts.attachmentId === undefined || opts.attachmentId === null
      ? null
      : (await db.select({
          id: mailAttachments.id,
          mailMessageId: mailAttachments.mailMessageId,
          filename: mailAttachments.filename,
          contentType: mailAttachments.contentType,
          data: mailAttachments.data,
          extractedText: mailAttachments.extractedText,
        }).from(mailAttachments).where(eq(mailAttachments.id, opts.attachmentId)).limit(1))[0] ?? null
    if (opts.attachmentId !== undefined && opts.attachmentId !== null && !attachment) {
      throw new Error(`attachment ${opts.attachmentId} not found`)
    }
    if (attachment && attachment.mailMessageId !== message.id) {
      throw new Error(`attachment ${attachment.id} does not belong to mail ${message.id}`)
    }

    const decision = classifyRosterCandidate({
      messageId: `<persisted-${message.id}>`,
      fromAddress: '',
      fromName: null,
      toAddresses: [],
      subject: message.subject,
      receivedAt: message.receivedAt,
      bodyText: message.bodyText,
      bodyHtml: null,
      headers: {},
      imapUid: null,
      imapBox: null,
      attachments: attachment
        ? [{
            filename: attachment.filename,
            contentType: attachment.contentType,
            sizeBytes: attachment.data.length,
            data: attachment.data,
          }]
        : [],
      attachmentSkips: [],
    })
    const sourceDecision = decision.sources[0]
    let outcome: RosterDraftParseOutcome
    try {
      outcome = attachment
        ? await parseAttachmentSource(attachment)
        : parseTextSource(message.bodyText, 'メール本文')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      outcome = { status: 'parse_failed', payload: {}, failureReason: reason }
      log.warn('roster_parse: source parse failed', {
        mailMessageId: message.id,
        attachmentId: attachment?.id ?? null,
        reason,
      })
    }

    const persisted = await persistRosterDraft(db, {
      sourceKind: attachment ? 'attachment' : 'body',
      sourceMailMessageId: message.id,
      sourceAttachmentId: attachment?.id ?? null,
      status: outcome.status,
      payload: outcome.payload,
      failureReason: outcome.failureReason,
      inferredRosterType: sourceDecision?.inferredRosterType ?? decision.inferredRosterType,
      inferredGrade: sourceDecision?.inferredGrade ?? decision.inferredGrade,
    })
    result = {
      runId,
      draftId: persisted.id,
      status: persisted.status,
      created: persisted.created,
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await db.update(mailWorkerRuns).set({
      finishedAt: sql`now()`,
      status: result?.status === 'pending_review' ? 'success' : 'partial',
      summary: {
        fetched: 0,
        classified: 0,
        drafts_created: result?.created ? 1 : 0,
        ai_failed: 0,
        imap_error: false,
        errors: runError || result?.status === 'parse_failed' ? [runError ?? 'roster parse failed'] : [],
        new_draft_subjects: [],
        roster_parse_status: result?.status ?? 'failed',
      },
      error: runError ?? (result?.status === 'parse_failed' ? 'roster parse failed' : null),
    }).where(eq(mailWorkerRuns.id, runId))
  }

  return result!
}

async function parseAttachmentSource(attachment: {
  filename: string
  data: Buffer
  extractedText: string | null
}): Promise<RosterDraftParseOutcome> {
  const lower = attachment.filename.toLowerCase()
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const sheets = await readExcel(attachment.data, attachment.filename)
    const parsed = parseRosterGrid(sheets)
    return {
      status: 'pending_review',
      payload: {
        parserVersion: ROSTER_PARSER_VERSION,
        format: 'excel',
        sheetName: parsed.sheetName,
        sheetNames: parsed.sheetNames,
        entries: parsed.entries,
        validationIssues: parsed.validationIssues,
      },
      failureReason: null,
    }
  }
  if (lower.endsWith('.txt')) {
    return parseTextSource(attachment.extractedText ?? attachment.data.toString('utf8'), attachment.filename)
  }
  if (lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.docx')) {
    return parseTextSource(attachment.extractedText, attachment.filename)
  }
  throw new Error(`未対応の名簿形式です: ${attachment.filename}`)
}

function parseTextSource(text: string | null, label: string): RosterDraftParseOutcome {
  const normalized = text?.trim() ?? ''
  if (!normalized) {
    const imageHint = label.toLowerCase().endsWith('.pdf') ? '画像PDFの可能性があります。' : ''
    throw new Error(`${label}からテキストを抽出できませんでした。${imageHint}原本を手動確認してください。`)
  }
  return {
    status: 'pending_review',
    payload: {
      parserVersion: ROSTER_PARSER_VERSION,
      format: 'text',
      text: normalized,
      entries: [],
      warnings: ['構造化できないテキスト原本です。氏名・級・当落区分を手動確認してください。'],
    },
    failureReason: 'テキスト抽出のみ完了しました。構造は手動確認が必要です。',
  }
}

async function persistRosterDraft(
  db: DbClient,
  input: {
    sourceKind: 'attachment' | 'body'
    sourceMailMessageId: number
    sourceAttachmentId: number | null
    status: RosterParseResult['status']
    payload: Record<string, unknown>
    failureReason: string | null
    inferredRosterType: 'applicant' | 'confirmed' | null
    inferredGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  },
): Promise<{ id: number; status: RosterParseResult['status']; created: boolean }> {
  const sourceWhere = input.sourceKind === 'attachment'
    ? and(
        eq(tournamentRosterImportDrafts.sourceKind, 'attachment'),
        eq(tournamentRosterImportDrafts.sourceAttachmentId, input.sourceAttachmentId!),
      )
    : and(
        eq(tournamentRosterImportDrafts.sourceKind, 'body'),
        eq(tournamentRosterImportDrafts.sourceMailMessageId, input.sourceMailMessageId),
      )
  const [existing] = await db.select({
    id: tournamentRosterImportDrafts.id,
    status: tournamentRosterImportDrafts.status,
  }).from(tournamentRosterImportDrafts).where(sourceWhere).limit(1)

  if (existing && existing.status !== 'parse_failed') {
    return {
      id: existing.id,
      status: existing.status === 'pending_review' ? 'pending_review' : input.status,
      created: false,
    }
  }
  if (existing) {
    const [updated] = await db.update(tournamentRosterImportDrafts).set({
      status: input.status,
      extractedPayload: input.payload,
      failureReason: input.failureReason,
      parserVersion: ROSTER_PARSER_VERSION,
      inferredRosterType: input.inferredRosterType,
      inferredGrade: input.inferredGrade,
      updatedAt: sql`now()`,
    }).where(and(
      eq(tournamentRosterImportDrafts.id, existing.id),
      eq(tournamentRosterImportDrafts.status, 'parse_failed'),
    )).returning({ id: tournamentRosterImportDrafts.id })
    if (updated) return { id: updated.id, status: input.status, created: false }
  }

  const [inserted] = await db.insert(tournamentRosterImportDrafts).values({
    sourceKind: input.sourceKind,
    sourceMailMessageId: input.sourceMailMessageId,
    sourceAttachmentId: input.sourceAttachmentId,
    parserVersion: ROSTER_PARSER_VERSION,
    status: input.status,
    extractedPayload: input.payload,
    failureReason: input.failureReason,
    inferredRosterType: input.inferredRosterType,
    inferredGrade: input.inferredGrade,
  }).onConflictDoNothing().returning({ id: tournamentRosterImportDrafts.id })
  if (inserted) return { id: inserted.id, status: input.status, created: true }

  const [raced] = await db.select({
    id: tournamentRosterImportDrafts.id,
    status: tournamentRosterImportDrafts.status,
  }).from(tournamentRosterImportDrafts).where(sourceWhere).limit(1)
  if (!raced) throw new Error('roster draft conflict occurred but the existing row was not found')
  return {
    id: raced.id,
    status: raced.status === 'parse_failed' ? 'parse_failed' : 'pending_review',
    created: false,
  }
}
