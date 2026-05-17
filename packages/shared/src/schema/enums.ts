import { pgEnum } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['admin', 'vice_admin', 'member'])
export const eventStatusEnum = pgEnum('event_status', ['draft', 'published', 'cancelled', 'done'])
export const gradeEnum = pgEnum('grade', ['A', 'B', 'C', 'D', 'E'])
export const genderEnum = pgEnum('gender', ['male', 'female'])
export const eventKindEnum = pgEnum('event_kind', ['individual', 'team'])
export const scheduleKindEnum = pgEnum('schedule_kind', ['practice', 'meeting', 'social', 'other'])
export const lineLinkMethodEnum = pgEnum('line_link_method', [
  'self_identify',
  'admin_link',
  'account_switch',
])

// mail-tournament-import (PR1)
export const mailMessageStatusEnum = pgEnum('mail_message_status', [
  'pending',
  'fetched',
  'parse_failed',
  'fetch_failed',
  'ai_processing',
  'ai_done',
  'ai_failed',
  // PDF cost guard: any attachment exceeded MAIL_WORKER_PDF_SIZE_LIMIT_KB and
  // the AI call was skipped pre-flight. Operator raises the env var and
  // reextracts when intentionally accepting the cost — automatic retry would
  // defeat the guard.
  'oversize_skipped',
  'archived',
])
export const mailClassificationEnum = pgEnum('mail_classification', [
  'tournament',
  'noise',
  'unknown',
])

// mail-tournament-import (PR2)
export const attachmentExtractionStatusEnum = pgEnum('attachment_extraction_status', [
  'pending',
  'extracted',
  'failed',
  'unsupported',
])

// mail-tournament-import (PR3)
export const tournamentDraftStatusEnum = pgEnum('tournament_draft_status', [
  'pending_review',
  'approved',
  'rejected',
  'ai_failed',
  'superseded',
])

// PR5 (mail-tournament-import)
export const lineChannelStatusEnum = pgEnum('line_channel_status', [
  'available',
  'assigned',
  'active',
  'system',
  'disabled',
])
export const mailWorkerRunKindEnum = pgEnum('mail_worker_run_kind', ['cron', 'manual'])
export const mailWorkerRunStatusEnum = pgEnum('mail_worker_run_status', [
  'running',
  'success',
  'imap_failed',
  'ai_failed',
  'partial',
])
export const mailWorkerJobStatusEnum = pgEnum('mail_worker_job_status', [
  'pending',
  'claimed',
  'done',
  'failed',
])
