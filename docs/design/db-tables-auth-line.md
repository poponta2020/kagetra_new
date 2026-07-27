# DBテーブル定義: 認証・会員・LINEチャネル基盤

`docs/design/db.md` から分割。生成元は `packages/shared/src/schema/` の各Drizzle定義。スキーマ変更時は同じコミットで更新すること。

## users（TS: `users`）

定義ファイル: `packages/shared/src/schema/auth.ts`

Auth.js v5 標準カラム + kagetra拡張プロフィール/権限。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | text | NOT NULL | `crypto.randomUUID()` | PK |
| name | text | NULL | — | UNIQUE |
| email | text | NULL | — | UNIQUE |
| email_verified | timestamp | NULL | — | |
| image | text | NULL | — | |
| line_user_id | text | NULL | — | UNIQUE |
| role | user_role (enum) | NOT NULL | 'member' | |
| grade | grade (enum) | NULL | — | |
| is_invited | boolean | NOT NULL | false | |
| invited_at | timestamp | NULL | — | |
| gender | gender (enum) | NULL | — | |
| affiliation | text | NULL | — | |
| dan | integer | NULL | — | CHECK `users_dan_range`: 0〜9 または NULL |
| zen_nichikyo | boolean | NOT NULL | false | |
| family_name | text | NULL | — | 招待制自己登録で収集する構造化氏名。既存会員はNULLのまま |
| given_name | text | NULL | — | 同上 |
| family_kana | text | NULL | — | 同上 |
| given_kana | text | NULL | — | 同上 |
| birth_date | date (string mode) | NULL | — | |
| phone | text | NULL | — | |
| postal_code | text | NULL | — | |
| address1 | text | NULL | — | |
| address2 | text | NULL | — | |
| deactivated_at | timestamptz | NULL | — | |
| line_linked_at | timestamptz | NULL | — | |
| line_link_method | line_link_method (enum) | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |
| notification_line_user_id | text | NULL | — | `line_channels.assigned_user_id` が正のペアリング先。逆ポインタは持たない（意図的） |

**制約・インデックス**: PK(id) / UNIQUE(name) / UNIQUE(email) / UNIQUE(line_user_id) / CHECK `users_dan_range`（`dan BETWEEN 0 AND 9 OR dan IS NULL`）

## accounts（TS: `accounts`）

定義ファイル: `packages/shared/src/schema/auth.ts`（Auth.js OAuthアカウント紐付け）

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| user_id | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| type | text | NOT NULL | — | `AdapterAccountType` |
| provider | text | NOT NULL | — | PK構成列 |
| provider_account_id | text | NOT NULL | — | PK構成列 |
| refresh_token | text | NULL | — | |
| access_token | text | NULL | — | |
| expires_at | integer | NULL | — | |
| token_type | text | NULL | — | |
| scope | text | NULL | — | |
| id_token | text | NULL | — | |
| session_state | text | NULL | — | |

**制約**: PK 複合(provider, provider_account_id)

## sessions（TS: `sessions`）

定義ファイル: `packages/shared/src/schema/auth.ts`

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| session_token | text | NOT NULL | — | PK |
| user_id | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| expires | timestamp | NOT NULL | — | |

## verification_tokens（TS: `verificationTokens`）

定義ファイル: `packages/shared/src/schema/auth.ts`

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| identifier | text | NOT NULL | — | PK構成列 |
| token | text | NOT NULL | — | PK構成列 |
| expires | timestamp | NOT NULL | — | |

**制約**: PK 複合(identifier, token)

## registration_invites（TS: `registrationInvites`）

定義ファイル: `packages/shared/src/schema/registration-invites.ts`

管理者発行の自己登録リンク。1リンクを複数人で使い回し可（利用回数上限なし、運用側で配布制御）。有効性は `revoked_at IS NULL AND now() < expires_at`。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | text | NOT NULL | `crypto.randomUUID()` | PK |
| token | text | NOT NULL | — | UNIQUE。`crypto.randomBytes(32).toString('base64url')` |
| expires_at | timestamptz | NOT NULL | — | |
| created_by | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL | `now()` | |
| revoked_at | timestamptz | NULL | — | 手動失効 |

## line_channels（TS: `lineChannels`）

定義ファイル: `packages/shared/src/schema/line-channels.ts`

LINE Messaging APIチャネルのプール。`purpose`で`system_notify`（単一・管理者通知用）/`event_broadcast`（30Botプール・申込グループごとに`assigned_entry_group_id`で予約）を区分。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| channel_id | text | NOT NULL | — | UNIQUE |
| channel_secret | text | NOT NULL | — | |
| channel_access_token | text | NOT NULL | — | |
| bot_id | text | NOT NULL | — | |
| status | line_channel_status (enum) | NOT NULL | 'available' | |
| purpose | line_channel_purpose (enum) | NOT NULL | 'system_notify' | |
| assigned_user_id | text | NULL | — | UNIQUE。FK→users.id ON DELETE SET NULL |
| assigned_entry_group_id | integer | NULL | — | UNIQUE。FK→entry_groups.id ON DELETE SET NULL（entry-groups: 予約先を event → entry_group へ移した） |
| webhook_destination_id | text | NULL | — | UNIQUE。LINE webhookの`destination`（BotのUSER ID） |
| notification_line_user_id | text | NULL | — | |
| note | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(channel_id) / UNIQUE(assigned_user_id)（NULL許容） / UNIQUE(assigned_entry_group_id)（NULL許容） / UNIQUE(webhook_destination_id)（NULL許容）

## push_subscriptions（TS: `pushSubscriptions`）

定義ファイル: `packages/shared/src/schema/push-subscriptions.ts`

Web Push購読情報（mail-triage-badge機能。1ユーザー複数端末を許容、端末=`endpoint`単位でUNIQUE）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| user_id | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| endpoint | text | NOT NULL | — | UNIQUE |
| p256dh | text | NOT NULL | — | |
| auth | text | NOT NULL | — | |
| user_agent | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| last_used_at | timestamptz | NULL | — | |

**インデックス**: `push_subscriptions_user_id_idx` on (user_id)
