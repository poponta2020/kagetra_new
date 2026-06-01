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

// event-line-broadcast
export const lineChannelPurposeEnum = pgEnum('line_channel_purpose', [
  'system_notify',
  'event_broadcast',
])
export const eventLineBroadcastStatusEnum = pgEnum('event_line_broadcast_status', [
  'invite_pending',
  'joined_waiting_code',
  'linked',
  'revoked',
  'released',
])
export const eventBroadcastMessageStatusEnum = pgEnum('event_broadcast_message_status', [
  'pending',
  'sending',
  'sent',
  'partial',
  'failed',
])

// event-lifecycle-notify: 会レベルの申込/支払い状態 + ライフサイクル通知ログ
export const eventEntryStatusEnum = pgEnum('event_entry_status', ['not_applied', 'applied'])
// payment_type は nullable カラム（未設定 = 支払い通知なし）。事前払い/現地払いで挙動が分岐する。
export const eventPaymentTypeEnum = pgEnum('event_payment_type', ['advance', 'onsite'])
// payment_status は payment_type='advance'（事前払い）のときのみ意味を持つ。
export const eventPaymentStatusEnum = pgEnum('event_payment_status', ['unpaid', 'paid'])
export const eventLifecycleNotificationTypeEnum = pgEnum('event_lifecycle_notification_type', [
  'entry_applied',
  'entry_deadline_advance',
  'entry_deadline_day',
  'payment_paid',
  'payment_deadline_advance',
  'payment_deadline_day',
  'onsite_payment_advance',
  'onsite_payment_day',
])
export const eventLifecycleNotificationStatusEnum = pgEnum('event_lifecycle_notification_status', [
  'sent',
  'failed',
  'skipped',
])

// mail-triage-badge: 受信メールの人手処理状態。AI/技術状態の mailMessageStatusEnum
// とは独立（status='ai_done' でも未処理＝管理者が未対応、はあり得る）。未処理バッジは
// triage_status != 'processed'（unprocessed + deferred）で算出する。
export const mailTriageStatusEnum = pgEnum('mail_triage_status', [
  'unprocessed',
  'processed',
  'deferred',
])
