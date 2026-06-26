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
  // invite-link-registration: member self-registered via an admin-issued
  // /register/<token> link (the LINE binding happens at row creation time).
  'invite_link',
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
// mail-inbox-mailer: AI 抽出を手動起動化したことで、起動〜完了の間だけ表示する
// 中間状態 `ai_processing` を追加。状態遷移は `ai_processing` → `pending_review`
// （成功）または `ai_failed`（失敗）。
export const tournamentDraftStatusEnum = pgEnum('tournament_draft_status', [
  'pending_review',
  'approved',
  'rejected',
  'ai_failed',
  'superseded',
  'ai_processing',
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
// mail-inbox-mailer: mail_worker_jobs.kind で fetch / manual_extract を識別する。
// fetch は cron/手動の IMAP 取得、manual_extract は inbox 詳細から起動する
// 個別メール抽出ジョブ（payload.mail_message_id 必須）。
// tournament-results: `result_parse` は結果 Excel を決定的パース（AI 不使用）して
// result_drafts へ格納するジョブ（payload.mail_message_id / attachment_id 必須）。
export const mailWorkerJobKindEnum = pgEnum('mail_worker_job_kind', [
  'fetch',
  'manual_extract',
  'result_parse',
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
  // entry-notify-lottery-treasurer: 申込完了時に参加者グループへ送る 2 通目（会計向け振込案内）。
  // entry_applied と別スロットで once-ever 管理する（(event_id, type) UNIQUE）。
  'entry_applied_treasurer',
])
export const eventLifecycleNotificationStatusEnum = pgEnum('event_lifecycle_notification_status', [
  'sent',
  'failed',
  'skipped',
])

// mail-triage-badge: 受信メールの人手処理状態。AI/技術状態の mailMessageStatusEnum
// とは独立（status='ai_done' でも未処理＝管理者が未対応、はあり得る）。未処理バッジは
// triage_status != 'processed'（= unprocessed）で算出する。
// mail-inbox-mailer (2026-06-07): `deferred` を廃止して 2 状態化。「保留」は
// 処理せず放置することが暗黙の保留である、というモデルに統合。
export const mailTriageStatusEnum = pgEnum('mail_triage_status', ['unprocessed', 'processed'])

// tournament-results: 全国大会結果の取込ドラフト・試合勝敗。
// result_draft_status: 結果 Excel 取込ドラフトの状態。tournament_draft_status の
// 兄弟だが AI 状態がない代わりに決定的パース失敗の `parse_failed` を持つ。
export const resultDraftStatusEnum = pgEnum('result_draft_status', [
  'pending_review',
  'approved',
  'rejected',
  'parse_failed',
  'superseded',
])
// 1 試合 = 選手視点 1 行の勝敗。不戦勝も勝者視点では win。
export const matchResultEnum = pgEnum('match_result', ['win', 'lose'])
// normal=実戦（勝敗数に算入）/ walkover=不戦勝 / forfeit=棄権。集計は normal のみ。
export const matchStatusEnum = pgEnum('match_status', ['normal', 'walkover', 'forfeit'])
