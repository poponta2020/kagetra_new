# DBテーブル定義: メール受信・添付・AI大会案内取込

`docs/design/db.md` から分割。生成元は `packages/shared/src/schema/` の各Drizzle定義。スキーマ変更時は同じコミットで更新すること。

## mail_messages（TS: `mailMessages`）

定義ファイル: `packages/shared/src/schema/mail-messages.ts`

1受信メール = 1行。`message_id`（RFC 5322 Message-ID）でde-dup。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| message_id | text | NOT NULL | — | UNIQUE |
| from_address | text | NOT NULL | — | |
| from_name | text | NULL | — | |
| to_addresses | text の配列 | NOT NULL | — | |
| subject | text | NULL | — | |
| received_at | timestamptz | NOT NULL | — | |
| body_text | text | NULL | — | |
| body_html | text | NULL | — | |
| status | mail_message_status (enum) | NOT NULL | 'pending' | |
| classification | mail_classification (enum) | NULL | — | AI抽出前はNULL。ノイズは`noise`を直接付与 |
| imap_uid | integer | NULL | — | |
| imap_box | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |
| triage_status | mail_triage_status (enum) | NOT NULL | 'unprocessed' | AI/技術状態の`status`とは直交 |
| triaged_at | timestamptz | NULL | — | |
| triaged_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| linked_event_id | integer | NULL | — | FK→events.id ON DELETE SET NULL |

**制約・インデックス**:
- UNIQUE(message_id)
- INDEX `mail_messages_received_at_desc_idx` on (received_at DESC)
- INDEX `mail_messages_triage_status_idx` on (triage_status)
- 部分INDEX `mail_messages_linked_event_id_idx` on (linked_event_id) WHERE linked_event_id IS NOT NULL

## mail_attachments（TS: `mailAttachments`）

定義ファイル: `packages/shared/src/schema/mail-attachments.ts`

1添付ファイル = 1行。`data`はcustomType（`bytea` ↔ Node `Buffer`）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| mail_message_id | integer | NOT NULL | — | FK→mail_messages.id ON DELETE CASCADE |
| filename | text | NOT NULL | — | |
| content_type | text | NOT NULL | — | |
| size_bytes | integer | NOT NULL | — | |
| data | bytea (customType) | NOT NULL | — | 30MB上限は取込前段で強制（超過行は作らない） |
| extracted_text | text | NULL | — | PDF/DOCX/XLSXの抽出テキスト。`unsupported`/`failed`はNULLのまま |
| extraction_status | attachment_extraction_status (enum) | NOT NULL | 'pending' | |
| created_at | timestamptz | NOT NULL | `now()` | |

**インデックス**: `mail_attachments_mail_message_id_idx` on (mail_message_id)

## attachment_share_tokens（TS: `attachmentShareTokens`）

定義ファイル: `packages/shared/src/schema/attachment-share-tokens.ts`

添付の60日期限公開ダウンロードURL。認証なし（LINEグループの非アカウントゲスト向け）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| mail_attachment_id | integer | NOT NULL | — | UNIQUE。FK→mail_attachments.id ON DELETE CASCADE |
| token | text | NOT NULL | — | UNIQUE |
| expires_at | timestamptz | NOT NULL | — | |
| access_count | integer | NOT NULL | 0 | 参照専用（認可判断には使わない） |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**: UNIQUE(mail_attachment_id) / UNIQUE(token) / INDEX `attachment_share_tokens_attachment_idx` on (mail_attachment_id) / INDEX `attachment_share_tokens_expires_at_idx` on (expires_at)

## tournament_drafts（TS: `tournamentDrafts`）

定義ファイル: `packages/shared/src/schema/tournament-drafts.ts`

AI抽出した大会案内 = 1メールにつき最大1行（`message_id`UNIQUE、再抽出はUPSERT）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| message_id | integer | NOT NULL | — | UNIQUE。FK→mail_messages.id ON DELETE CASCADE |
| status | tournament_draft_status (enum) | NOT NULL | 'pending_review' | |
| confidence | numeric(3,2) | NULL | — | CHECK 0〜1またはNULL |
| is_correction | boolean | NOT NULL | false | |
| references_subject | text | NULL | — | |
| superseded_by_draft_id | integer | NULL | — | 自己参照（差し替え元）。FK制約はmigrationのraw ALTERで付与 |
| extracted_payload | jsonb | NOT NULL | `'{}'::jsonb` | |
| ai_raw_response | text | NULL | — | |
| prompt_version | text | NOT NULL | — | |
| ai_model | text | NOT NULL | — | |
| ai_tokens_input | integer | NULL | — | |
| ai_tokens_output | integer | NULL | — | |
| ai_cost_usd | numeric(10,6) | NULL | — | |
| event_id | integer | NULL | — | 訂正版ドラフトが指す既存イベント（`linkDraftToEvent`専用）。FK→events.id ON DELETE SET NULL |
| approved_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| approved_at | timestamptz | NULL | — | |
| rejected_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| rejected_at | timestamptz | NULL | — | |
| rejection_reason | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**:
- UNIQUE(message_id)
- CHECK `tournament_drafts_confidence_range`（confidence BETWEEN 0 AND 1 OR NULL）
- INDEX `idx_drafts_status_created` on (status, created_at DESC)
- 部分INDEX `idx_drafts_event_id` on (event_id) WHERE event_id IS NOT NULL

## mail_worker_runs（TS: `mailWorkerRuns`）

定義ファイル: `packages/shared/src/schema/mail-worker.ts`

mail-worker実行1回分（cron/manual）のログ。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| started_at | timestamptz | NOT NULL | `now()` | |
| finished_at | timestamptz | NULL | — | |
| kind | mail_worker_run_kind (enum) | NOT NULL | — | |
| status | mail_worker_run_status (enum) | NOT NULL | 'running' | |
| summary | jsonb | NULL | — | 連続失敗検知（`evaluateConsecutiveFailures`）に使うJSON |
| error | text | NULL | — | |
| triggered_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL。`kind='manual'`時のみ設定 |
| since | timestamptz | NULL | — | |

## mail_worker_jobs（TS: `mailWorkerJobs`）

定義ファイル: `packages/shared/src/schema/mail-worker.ts`

管理者起動のmail-worker実行キュー。`FOR UPDATE SKIP LOCKED`でdispatcherがclaimする。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| requested_at | timestamptz | NOT NULL | `now()` | |
| requested_by_user_id | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| since | timestamptz | NULL | — | |
| status | mail_worker_job_status (enum) | NOT NULL | 'pending' | |
| kind | mail_worker_job_kind (enum) | NOT NULL | 'fetch' | fetch / manual_extract / result_parse |
| payload | jsonb | NULL | — | `manual_extract`は`{mail_message_id}`必須。`result_parse`は`{mail_message_id, attachment_id}`必須 |
| claimed_at | timestamptz | NULL | — | |
| run_id | integer | NULL | — | FK→mail_worker_runs.id ON DELETE SET NULL |
| error | text | NULL | — | |

**インデックス**: `idx_mail_worker_jobs_status_requested_at` on (status, requested_at) / `idx_mail_worker_jobs_status_kind_requested_at` on (status, kind, requested_at)
