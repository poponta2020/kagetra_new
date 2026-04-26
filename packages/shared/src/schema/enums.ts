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
