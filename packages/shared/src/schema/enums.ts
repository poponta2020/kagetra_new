import { pgEnum } from 'drizzle-orm/pg-core'

// guest-role: `guest` は「大会の参加登録だけができる」第4ロール。サークル員だが
// 協会への登録会が他会である人を、会の申込作業（申込書 xlsx・参加費集計・申込管理
// ボード・未申込督促）から外したまま「出場予定がある人」として保持するために足した。
// 権限順序としては member より下だが、**member の下位互換ではない**（member ができる
// ことの部分集合でもない: 会内締切に縛られず回答できる）。認可は許可リストで判定する。
export const userRoleEnum = pgEnum('user_role', ['admin', 'vice_admin', 'member', 'guest'])

// guest-role: 招待リンクの種別。`user_role` を再利用せず専用 enum にしているのは、
// 招待リンクから作れるロールを `member` / `guest` の2つに構造的に限定するため
// （`admin` を入れられる形にしない）。
export const registrationInviteKindEnum = pgEnum('registration_invite_kind', [
  'member',
  'guest',
])
export const eventStatusEnum = pgEnum('event_status', ['published', 'cancelled', 'done'])
export const gradeEnum = pgEnum('grade', ['A', 'B', 'C', 'D', 'E'])
export const genderEnum = pgEnum('gender', ['male', 'female'])
export const eventKindEnum = pgEnum('event_kind', ['individual', 'team'])
// Legacy enum retained with scheduleItems until the backup-verified DB cleanup.
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
  // tournament-lottery-trends: roster source -> structured review draft.
  // The dispatcher starts claiming this kind in Task 3; Task 1 only persists
  // the queue contract so web and worker can share the same enum safely.
  'roster_parse',
])

// event-line-broadcast
// event-grade-group-broadcast: `grade_broadcast` は級別グループ (A〜E) 常設配信用に
// 既存プールから転換したチャネル。1 チャネル = 1 purpose なので、webhook の振り分けは
// 解決したチャネルの purpose を見るだけで排他になる。
export const lineChannelPurposeEnum = pgEnum('line_channel_purpose', [
  'system_notify',
  'event_broadcast',
  'grade_broadcast',
])
export const eventLineBroadcastStatusEnum = pgEnum('event_line_broadcast_status', [
  'invite_pending',
  'joined_waiting_code',
  'linked',
  'revoked',
  'released',
])
// event-grade-group-broadcast: 級グループ常設紐付けの状態。
// eventLineBroadcastStatusEnum と値は似ているが `released`（大会終了で自動解放）を
// 持たない — 級グループの紐付けは常設で、大会単位に解放されないため。
export const lineGradeGroupStatusEnum = pgEnum('line_grade_group_status', [
  'invite_pending',
  'joined_waiting_code',
  'linked',
  'revoked',
])
export const eventBroadcastMessageStatusEnum = pgEnum('event_broadcast_message_status', [
  'pending',
  'sending',
  'sent',
  'partial',
  'failed',
])

// event-lifecycle-notify: 会レベルの申込/支払い状態 + ライフサイクル通知ログ
// entry-overdue-alert: `not_applying`（申込なし）を追加。「申込者がいないため会として
// 今回は主催者へ申し込まない」という終端判断で、管理者が手動で設定する。既存の申込締切
// リマインドは `entry_status='not_applied'` で絞っているため、3 値目にすることで
// 見送った大会が自動的にリマインド対象から外れる（条件式は変更しない）。
export const eventEntryStatusEnum = pgEnum('event_entry_status', [
  'not_applied',
  'applied',
  'not_applying',
])
// payment_type は nullable カラム（未設定 = 支払い通知なし）。事前払い/現地払いで挙動が分岐する。
export const eventPaymentTypeEnum = pgEnum('event_payment_type', ['advance', 'onsite'])
// mail-ai-extract-refinements: 振込締切の「状態」。payment_deadline が NULL のとき、
// 「案内に後日連絡と書いてある(later_notice)」と「そもそも記載が無い/読めなかった
// (unspecified)」を区別する。前者は追加調査不要、後者は人が原文を当たるべき状態で、
// 対応がまったく違う。値は英語（既存の event_payment_type が advance/onsite である
// 慣行に合わせる）。UI は日本語で表示する。
// events テーブル側に CHECK `(payment_deadline IS NOT NULL) = (kind = 'fixed')` を張り、
// 日付と状態が食い違う行を DB が拒否する。
export const eventPaymentDeadlineKindEnum = pgEnum('event_payment_deadline_kind', [
  'fixed',
  'later_notice',
  'unspecified',
])
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

// mail-inbox-mailer (2026-08-02): 管理者が手で選ぶメール種別。統合処理フォームの
// 分岐（AI 抽出 / 名簿採用 / LINE 配信の出し分け）の起点。
// ★AI・pre-filter が書く `mail_classification` とは**別軸**で、互いに書き換えない
// （同居させると再抽出で手動選択が消える。要件 §6）。「未選択」は enum 値ではなく
// 列の NULL で表す（「その他＝組合せ表・会場案内・領収書」の意味も兼ねる）。
export const mailKindEnum = pgEnum('mail_kind', [
  'tournament_notice',
  'applicant_roster',
  'confirmed_roster',
])

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

// tournament-entry-rosters (PR-1a baseline): 大会系列（tournament_series）/開催
// （tournament_series_editions）のマスタ。既に raw SQL で本番投入済み（series 180 /
// editions 1236）の現物を Drizzle 管理下に取り込む。enum 名・値は本番現物
// （C:/tmp/prod_schema_series.sql）に一致させる。
// kind: 個人戦/団体戦の区別（系列単位）。
export const tournamentKindEnum = pgEnum('tournament_kind', ['individual', 'team'])
// status: 開催の状態。held=開催済 / cancelled=中止 / unconfirmed=未確定（将来開催等）。
export const tournamentStatusEnum = pgEnum('tournament_status', [
  'held',
  'cancelled',
  'unconfirmed',
])

// tournament-entry-rosters (PR-3 名簿): 申込/確定名簿。
// roster_type: applicant=申込者名簿（締切後・抽選前）/ confirmed=確定名簿（抽選後。抽選不要でも発行）。
export const rosterTypeEnum = pgEnum('roster_type', ['applicant', 'confirmed'])
// roster_entry_status: 名簿各行の出場状態（出場回数の素データ）。
// applied=申込（applicant 名簿の既定）/ confirmed=出場確定 / carried_up=繰上出場 /
// carry_up_declined=繰上辞退 / cancelled=取消。confirmed 名簿の各行に保持し、繰上は再取込で更新。
export const rosterEntryStatusEnum = pgEnum('roster_entry_status', [
  'applied',
  'confirmed',
  'carried_up',
  'carry_up_declined',
  'cancelled',
])

// tournament-lottery-trends: classification of an edition for appearance counts.
// Existing editions default to unknown and are never inferred as official.
export const competitionCategoryEnum = pgEnum('competition_category', [
  'official',
  'new_year',
  'hosted',
  'supported',
  'other',
  'unknown',
])

// Outcome at the lottery-result publication point. This is independent from
// roster_entry_status, which continues to describe the later participation lifecycle.
export const selectionOutcomeEnum = pgEnum('selection_outcome', [
  'accepted',
  'waitlisted',
  'rejected',
  'unknown',
])

export const lotterySelectionStatusEnum = pgEnum('lottery_selection_status', [
  'lottery',
  'under_capacity',
  'no_capacity',
  'unknown',
])

export const rosterImportDraftStatusEnum = pgEnum('roster_import_draft_status', [
  'pending_review',
  'approved',
  'rejected',
  'parse_failed',
  'superseded',
])

export const rosterImportSourceKindEnum = pgEnum('roster_import_source_kind', [
  'attachment',
  'body',
])

// entry-form-autofill: 申込書下書き作成履歴の状態。
// pending=xlsx 生成・履歴保存は済んだが APPEND をまだ開始していない /
// appending=APPEND 実行中（この行を claim 済み） /
// created=Yahoo の Draft へ APPEND 成功 / imap_failed=APPEND に失敗（xlsx 再
// ダウンロードと再試行が可能）。
//
// 履歴は APPEND の**前**に保存する（失敗しても編集値と生成 xlsx を失わないため）。
// このとき created で入れてしまうと、挿入から結果更新までの間にプロセスが落ちた
// 場合に「Yahoo に下書きが無いのに履歴だけ成功」という嘘が永久に残る。初期値を
// pending にして、成功が確認できたときだけ created へ上げる。
export const entryFormDraftStatusEnum = pgEnum('entry_form_draft_status', [
  'pending',
  // APPEND 実行中（claim 済み）。再試行はこの遷移を条件付き UPDATE で奪い合うため、
  // 同じ行に対する同時再試行のうち1つだけが IMAP へ進む（下書きの重複防止）。
  'appending',
  'created',
  'imap_failed',
])

// openchat-broadcast: 大会オープンチャット招待 URL の出典（監査用・自動記録）。
// body=メール本文 / attachment_text=添付の抽出済みテキスト /
// qr=画像・ページ画像から QR デコード / manual=管理者の手入力
// （URL がメールに存在しない大会を救う唯一の入口。requirements §3.2.2）。
export const openChatSourceEnum = pgEnum('open_chat_source', [
  'body',
  'attachment_text',
  'qr',
  'manual',
])

// openchat-broadcast: オープンチャット配信 1 回の結果。
// Flex は 1 通しか送らないため `partial` は存在し得ない（event_broadcast_messages
// との違い）。skipped は配信直前に LINE 紐付けが変わっていた場合（AC-39）。
export const openChatBroadcastStatusEnum = pgEnum('open_chat_broadcast_status', [
  'sent',
  'failed',
  'skipped',
])

// payment-receipt-broadcast: 支払報告 1 回の送信結果。
// sent=LINE へ送れた / failed=push 失敗（状態変更は巻き戻さない・要件 §3.2.4-16）/
// skipped_unlinked=グループに linked な LINE 連携が無く送らなかった（§3.2.4-15）/
// skipped_no_change=紐付けはあるが送るものが無かった（証憑0枚 ∧ once-ever を
// claim できる日が1つも無い＝未払に戻して再報告したケース。AC-14 で「送らない」のが
// 正しい経路）。
// ★`skipped_unlinked` に畳まない。畳むと画面に「LINE 未連携のため送信していない」と
// 出て**事実と違う**うえ、記録にも恒久的に嘘が残る。
// sending=送信権を取った実行が進行中（初回送信・再送で共有する排他フラグ）。
// ★これが無いと、履歴を同時に開いた2人が同じ報告を再送して**同じ文面と証憑が2回
// 届く**。加えて初回送信中の行が「送信失敗」と表示され、それを見た別の管理者が
// 再送を押して初回送信と競合する（誤った再送の誘発）。
export const paymentReportStatusEnum = pgEnum('payment_report_status', [
  'sending',
  'sent',
  'failed',
  'skipped_unlinked',
  'skipped_no_change',
])

// payment-receipt-broadcast: 文面に載せた「景虎上の想定金額」の出典（要件 §3.2.3-9）。
// payment_notice=送信済み振込連絡の総額 / tally=その場の参加費集計 /
// none=いずれも算出できず金額行を省いた。
// ★級未設定の注記（`※級未設定 N名は未算入`）が付くのは tally のときだけ（AC-11）。
export const paymentReportAmountSourceEnum = pgEnum('payment_report_amount_source', [
  'payment_notice',
  'tally',
  'none',
])
