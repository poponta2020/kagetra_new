# データベース設計書

このファイルは `packages/shared/src/schema/` の Drizzle 定義から生成する。スキーマ変更時は同じコミットで更新すること。

テーブル定義表は本ファイルではなく、ドメイン別に分割した以下へ記載する（各500行以内）。本ファイルは索引・enum一覧・リレーション概要のみを持つ。

- `docs/design/db-tables-auth-line.md` — 認証・会員・LINEチャネル基盤
- `docs/design/db-tables-events.md` — イベント・出欠・スケジュール・LINE配信
- `docs/design/db-tables-mail.md` — メール受信・添付・AI大会案内取込
- `docs/design/db-tables-tournaments.md` — 大会系列・名簿・選手・結果（試合）

## enum 一覧

すべて `packages/shared/src/schema/enums.ts` で `pgEnum` 定義。DB上のenum名（snake_case）とTSエクスポート名を併記する。

| enum名 (DB) | TSエクスポート名 | 値 |
|---|---|---|
| user_role | userRoleEnum | admin, vice_admin, member, guest |
| event_status | eventStatusEnum | published, cancelled, done |
| grade | gradeEnum | A, B, C, D, E |
| gender | genderEnum | male, female |
| event_kind | eventKindEnum | individual, team |
| schedule_kind | scheduleKindEnum | legacy: practice, meeting, social, other（第2段階の DB 削除対象） |
| line_link_method | lineLinkMethodEnum | self_identify, admin_link, account_switch, invite_link |
| registration_invite_kind | registrationInviteKindEnum | member, guest（招待リンクが作るロール。`user_role` の再利用ではなく専用enum＝リンクから admin を作れない） |
| mail_message_status | mailMessageStatusEnum | pending, fetched, parse_failed, fetch_failed, ai_processing, ai_done, ai_failed, oversize_skipped, archived |
| mail_classification | mailClassificationEnum | tournament, noise, unknown |
| attachment_extraction_status | attachmentExtractionStatusEnum | pending, extracted, failed, unsupported |
| tournament_draft_status | tournamentDraftStatusEnum | pending_review, approved, rejected, ai_failed, superseded, ai_processing |
| line_channel_status | lineChannelStatusEnum | available, assigned, active, system, disabled |
| mail_worker_run_kind | mailWorkerRunKindEnum | cron, manual |
| mail_worker_run_status | mailWorkerRunStatusEnum | running, success, imap_failed, ai_failed, partial |
| mail_worker_job_status | mailWorkerJobStatusEnum | pending, claimed, done, failed |
| mail_worker_job_kind | mailWorkerJobKindEnum | fetch, manual_extract, result_parse, roster_parse |
| line_channel_purpose | lineChannelPurposeEnum | system_notify, event_broadcast |
| event_line_broadcast_status | eventLineBroadcastStatusEnum | invite_pending, joined_waiting_code, linked, revoked, released |
| event_broadcast_message_status | eventBroadcastMessageStatusEnum | pending, sending, sent, partial, failed |
| open_chat_source | openChatSourceEnum | body, attachment_text, qr, manual |
| open_chat_broadcast_status | openChatBroadcastStatusEnum | sent, failed, skipped |
| event_entry_status | eventEntryStatusEnum | not_applied, applied, not_applying |
| event_payment_type | eventPaymentTypeEnum | advance, onsite |
| event_payment_status | eventPaymentStatusEnum | unpaid, paid |
| event_payment_deadline_kind | eventPaymentDeadlineKindEnum | fixed, later_notice, unspecified |
| event_lifecycle_notification_type | eventLifecycleNotificationTypeEnum | entry_applied, entry_deadline_advance, entry_deadline_day, payment_paid, payment_deadline_advance, payment_deadline_day, onsite_payment_advance, onsite_payment_day, entry_applied_treasurer |
| event_lifecycle_notification_status | eventLifecycleNotificationStatusEnum | sent, failed, skipped |
| mail_triage_status | mailTriageStatusEnum | unprocessed, processed |
| mail_kind | mailKindEnum | tournament_notice, applicant_roster, confirmed_roster |
| result_draft_status | resultDraftStatusEnum | pending_review, approved, rejected, parse_failed, superseded |
| match_result | matchResultEnum | win, lose |
| match_status | matchStatusEnum | normal, walkover, forfeit |
| tournament_kind | tournamentKindEnum | individual, team |
| tournament_status | tournamentStatusEnum | held, cancelled, unconfirmed |
| roster_type | rosterTypeEnum | applicant, confirmed |
| roster_entry_status | rosterEntryStatusEnum | applied, confirmed, carried_up, carry_up_declined, cancelled |
| entry_form_draft_status | entryFormDraftStatusEnum | pending, appending, created, imap_failed |

## ドメイン別テーブル一覧

### 認証・会員・LINEチャネル基盤（db-tables-auth-line.md）

| テーブル名 (DB) | TSエクスポート名 | 責務 | 定義ファイル |
|---|---|---|---|
| users | users | 会員（Auth.js v5 ユーザー + kagetra拡張プロフィール/権限） | schema/auth.ts |
| accounts | accounts | Auth.js OAuth アカウント紐付け（LINEプロバイダ） | schema/auth.ts |
| sessions | sessions | Auth.js セッション | schema/auth.ts |
| verification_tokens | verificationTokens | Auth.js メール検証トークン（未使用機能だがアダプタ要件） | schema/auth.ts |
| registration_invites | registrationInvites | 管理者発行の招待制自己登録リンク | schema/registration-invites.ts |
| line_channels | lineChannels | LINE Messaging API チャネルのプール（system_notify/event_broadcast/grade_broadcast） | schema/line-channels.ts |
| push_subscriptions | pushSubscriptions | Web Push 購読情報（未処理メールバッジ通知） | schema/push-subscriptions.ts |
| app_settings | appSettings | 汎用 key-value の会定数ストア（申込書の会情報6項目ほか） | schema/app-settings.ts |

### イベント・出欠・スケジュール・LINE配信（db-tables-events.md）

| テーブル名 (DB) | TSエクスポート名 | 責務 | 定義ファイル |
|---|---|---|---|
| events | events | 大会・イベント本体（申込/支払い状態含む） | schema/events.ts |
| event_attendances | eventAttendances | イベントへの出欠回答 | schema/event-attendances.ts |
| schedule_items | scheduleItems | legacy: 廃止済み予定機能の保持データ（第2段階の DB 削除対象） | schema/schedule-items.ts |
| event_line_broadcasts | eventLineBroadcasts | 申込グループ⇔LINEグループの1:1紐付け | schema/event-line-broadcasts.ts |
| event_broadcast_messages | eventBroadcastMessages | 1メール→1LINEグループ配信の実行ログ | schema/event-broadcast-messages.ts |
| event_lifecycle_notifications | eventLifecycleNotifications | 申込/支払いライフサイクル通知のonce-everログ | schema/event-lifecycle-notifications.ts |
| line_grade_group_bindings | lineGradeGroupBindings | 級(A〜E)⇔級別LINEグループの常設1:1紐付け | schema/line-grade-group-bindings.ts |
| event_grade_broadcasts | eventGradeBroadcasts | (大会,級)単位の級グループ配信記録（claim/送信済み） | schema/event-grade-broadcasts.ts |
| entry_group_open_chats | entryGroupOpenChats | 大会当日用LINEオープンチャットの招待URL（申込グループ帰属） | schema/entry-group-open-chats.ts |
| entry_group_open_chat_broadcasts | entryGroupOpenChatBroadcasts | オープンチャット配信の追記専用ログ（UNIQUEを持たない） | schema/entry-group-open-chat-broadcasts.ts |
| entry_form_drafts | entryFormDrafts | 申込書下書きの作成履歴（生成xlsxコピー含む） | schema/entry-form-drafts.ts |

### メール受信・添付・AI大会案内取込（db-tables-mail.md）

| テーブル名 (DB) | TSエクスポート名 | 責務 | 定義ファイル |
|---|---|---|---|
| mail_messages | mailMessages | 受信メール本体（IMAP取込・分類・処理状態） | schema/mail-messages.ts |
| mail_attachments | mailAttachments | メール添付ファイル（バイナリ+抽出テキスト） | schema/mail-attachments.ts |
| attachment_share_tokens | attachmentShareTokens | 添付の期限付き公開ダウンロードトークン | schema/attachment-share-tokens.ts |
| tournament_drafts | tournamentDrafts | AI抽出した大会案内のレビュードラフト | schema/tournament-drafts.ts |
| mail_worker_runs | mailWorkerRuns | mail-worker実行1回分のログ | schema/mail-worker.ts |
| mail_worker_jobs | mailWorkerJobs | mail-worker手動起動ジョブキュー | schema/mail-worker.ts |

### 大会系列・名簿・選手・結果（db-tables-tournaments.md）

| テーブル名 (DB) | TSエクスポート名 | 責務 | 定義ファイル |
|---|---|---|---|
| tournament_series | tournamentSeries | 大会「系列」マスタ（第N回○○大会の○○） | schema/tournament-series.ts |
| tournament_series_editions | tournamentSeriesEditions | 系列の「開催（第N回）」。events/tournamentsを束ねるハブ | schema/tournament-series-editions.ts |
| tournament_entry_rosters | tournamentEntryRosters | 大会の名簿ヘッダ（申込者/確定名簿） | schema/tournament-entry-rosters.ts |
| tournament_entry_roster_entries | tournamentEntryRosterEntries | 名簿の各行（1人分） | schema/tournament-entry-roster-entries.ts |
| tournament_confirmed_roster_publications | tournamentConfirmedRosterPublications | 出場回数へ算入する確定名簿発表 | schema/tournament-confirmed-roster-publications.ts |
| tournament_edition_grade_lottery_facts | tournamentEditionGradeLotteryFacts | 開催回・級別の抽選集計用ファクト | schema/tournament-edition-grade-lottery-facts.ts |
| tournament_roster_import_drafts | tournamentRosterImportDrafts | メール原本から抽出した名簿レビュードラフト | schema/tournament-roster-import-drafts.ts |
| tournament_entry_roster_files | tournamentEntryRosterFiles | パースせず原本のまま採用した名簿（添付へのポインタ） | schema/tournament-entry-roster-files.ts |
| players | players | 選手マスタ（姓名のみで名寄せしたグルーピング層） | schema/players.ts |
| tournaments | tournaments | 1大会 = 1取込ファイル（結果取込の実体） | schema/tournaments.ts |
| tournament_classes | tournamentClasses | 大会内の「級（クラス）」 | schema/tournament-classes.ts |
| tournament_participants | tournamentParticipants | 大会・級ごとの出場スナップショット | schema/tournament-participants.ts |
| matches | matches | 1試合 = 選手視点1行の勝敗 | schema/matches.ts |
| result_drafts | resultDrafts | 結果Excelの取込ドラフト（決定的パース） | schema/result-drafts.ts |

## リレーション概要

`packages/shared/src/schema/relations.ts` で定義。ORM `relations()` を張っているペアのみを記載する（列/FKは存在するがORM relationを意図的に張っていないケースも明記する）。

- `tournamentSeries` 1 : N `tournamentSeriesEditions`（`editions`）
- `tournamentSeriesEditions` 1 : N `events`（`events`）、1 : N `tournaments`（`tournaments`）／N : 1 `tournamentSeries`（`series`）
- `entryGroups` 1 : N `events`（`events`）／1 : 1 `eventLineBroadcasts`（`lineBroadcast`、逆参照は省略形relation）
- `events` N : 1 `entryGroups`（`entryGroup`）／N : 1 `tournamentSeriesEditions`（`edition`）／1 : N `tournamentEntryRosters`（`rosters`）／1 : N `eventAttendances`（`attendances`）／N : 1 `users`（`creator` via `createdBy`）／1 : N `eventLifecycleNotifications`（`lifecycleNotifications`）／N : 1 `tournamentDrafts`（`sourceDraft`、relationName: `eventSourceDraft`）。LINE 紐付けは entry-groups で申込グループへ移ったため `events` 側の直接 relation は撤去（`entryGroup: { with: { lineBroadcast: true } }` を辿る）
- `eventAttendances` N : 1 `events`（`event`）／N : 1 `users`（`user`）
- `users` 1 : N `eventAttendances`（`attendances`）／1 : N `pushSubscriptions`（`pushSubscriptions`）／1 : N `players`（`players`）。`line_channels.assigned_user_id`（1:1相当）は逆方向relationを張らず`WHERE assigned_user_id = ?`で引く運用
- `scheduleItems` N : 1 `users`（`owner` via `ownerId`、legacy DB 関係）
- `mailMessages` 1 : N `mailAttachments`（`attachments`）／1 : 1 `tournamentDrafts`（`draft`、`messageId`一致）／1 : N `eventBroadcastMessages`（`broadcastMessages`）／N : 1 `users`（`triagedBy`）／1 : 1 `resultDrafts`（`resultDraft`、`messageId`一致）
- `mailAttachments` N : 1 `mailMessages`（`mail`）／1 : N `attachmentShareTokens`（`shareTokens`）
- `tournamentDrafts` N : 1 `mailMessages`（`mail`）／N : 1 `events`（`event`、`eventId`経由・relationName: `draftCorrectionEvent`）／1 : N `events`（`materializedEvents`、relationName: `eventSourceDraft`）
- `lineChannels` N : 1 `users`（`assignedUser`）／N : 1 `entryGroups`（`assignedEntryGroup`、entry-groups: Bot予約先を event → entry_group へ移した）
- `entryGroupOpenChats` N : 1 `entryGroups`（`entryGroup`）／N : 1 `mailMessages`（`sourceMailMessage`）。`entryGroupOpenChatBroadcasts` N : 1 `entryGroups`（`entryGroup`）
- `eventLineBroadcasts` N : 1 `entryGroups`（`entryGroup`、entry-groups: 帰属を event → entry_group へ移した）／N : 1 `lineChannels`（`lineChannel`）／1 : N `eventBroadcastMessages`（`messages`）
- `eventBroadcastMessages` N : 1 `eventLineBroadcasts`（`broadcast`）／N : 1 `mailMessages`（`mail`）
- `attachmentShareTokens` N : 1 `mailAttachments`（`attachment`）
- `mailWorkerRuns` N : 1 `users`（`triggeredBy`）／1 : N `mailWorkerJobs`（`jobs`）
- `mailWorkerJobs` N : 1 `users`（`requestedBy`）／N : 1 `mailWorkerRuns`（`run`）
- `eventLifecycleNotifications` N : 1 `events`（`event`）
- `pushSubscriptions` N : 1 `users`（`user`）
- `players` N : 1 `users`（`user`）／1 : N `tournamentParticipants`（`participants`）
- `tournaments` 1 : N `tournamentClasses`（`classes`）／N : 1 `tournamentSeriesEditions`（`edition`）
- `tournamentClasses` N : 1 `tournaments`（`tournament`）／1 : N `tournamentParticipants`（`participants`）／1 : N `matches`（`matches`）
- `tournamentParticipants` N : 1 `tournamentClasses`（`class`）／N : 1 `players`（`player`）／1 : N `matches`（`matches`）
- `matches` N : 1 `tournamentClasses`（`class`）／N : 1 `tournamentParticipants`（`participant`、composite FK `(participantId, classId)` に一致させたrelation）
- `resultDrafts` N : 1 `mailMessages`（`mail`）／N : 1 `tournaments`（`tournament`）
- `tournamentEntryRosters` N : 1 `events`（`event`）／N : 1 `mailAttachments`（`sourceAttachment`）／1 : N `tournamentEntryRosterEntries`（`entries`）
- `tournamentEntryRosterEntries` N : 1 `tournamentEntryRosters`（`roster`）／N : 1 `players`（`player`）／N : 1 `users`（`user`）

意図的にORM relationを張っていないFK/列（`relations.ts`冒頭コメントに明記）:
- `tournaments.sourceResultDraftId`（プロビナンス。FK自体はmigrationのraw ALTERで付与）
- `matches.opponentParticipantId`（同一テーブルペアの`relationName`重複を避けるため）
