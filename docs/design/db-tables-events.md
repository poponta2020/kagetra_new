# DBテーブル定義: イベント・出欠・スケジュール・LINE配信

`docs/design/db.md` から分割。生成元は `packages/shared/src/schema/` の各Drizzle定義。スキーマ変更時は同じコミットで更新すること。

## events（TS: `events`）

定義ファイル: `packages/shared/src/schema/events.ts`

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| title | text | NOT NULL | — | |
| description | text | NULL | — | |
| event_date | date (string mode) | NOT NULL | — | |
| location | text | NULL | — | |
| capacity | integer | NULL | — | |
| status | event_status (enum) | NOT NULL | 'published' | |
| created_by | text | NULL | — | FK→users.id（ON DELETE指定なし） |
| formal_name | text | NULL | — | |
| official | boolean | NOT NULL | true | |
| kind | event_kind (enum) | NOT NULL | 'individual' | |
| entry_deadline | date (string mode) | NULL | — | |
| internal_deadline | date (string mode) | NULL | — | |
| edition_id | integer | NULL | — | FK `events_edition_id_fkey`→tournament_series_editions.id ON DELETE SET NULL |
| eligible_grades | grade (enum) の配列 | NULL | — | |
| fee_jpy | integer | NULL | — | |
| payment_deadline | date (string mode) | NULL | — | |
| lottery_date | date (string mode) | NULL | — | NULL=抽選なし |
| payment_info | text | NULL | — | |
| payment_method | text | NULL | — | |
| entry_method | text | NULL | — | |
| organizer | text | NULL | — | |
| capacity_a | integer | NULL | — | |
| capacity_b | integer | NULL | — | |
| capacity_c | integer | NULL | — | |
| capacity_d | integer | NULL | — | |
| capacity_e | integer | NULL | — | |
| entry_status | event_entry_status (enum) | NOT NULL | 'not_applied' | |
| entry_applied_at | timestamptz | NULL | — | |
| payment_type | event_payment_type (enum) | NULL | — | NULL=支払い通知なし |
| payment_status | event_payment_status (enum) | NOT NULL | 'unpaid' | `payment_type='advance'`時のみ意味を持つ |
| payment_paid_at | timestamptz | NULL | — | |
| tournament_draft_id | integer | NULL | — | AI取込元ドラフトへの参照。FK制約はmigrationのraw ALTERで付与（ON DELETE SET NULL） |
| tournament_draft_unit_key | text | NULL | — | ドラフトpayload内の該当イベント単位キー |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約・インデックス**:
- 部分UNIQUE `events_tournament_draft_unit_key_uniq` on (tournament_draft_id, tournament_draft_unit_key) WHERE 両方NOT NULL
- FK `events_edition_id_fkey`（edition_id → tournament_series_editions.id）ON DELETE SET NULL
- INDEX `events_edition_id_idx` on (edition_id)

## event_attendances（TS: `eventAttendances`）

定義ファイル: `packages/shared/src/schema/event-attendances.ts`

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_id | integer | NOT NULL | — | FK→events.id ON DELETE CASCADE |
| user_id | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| attend | boolean | NOT NULL | — | |
| comment | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(event_id, user_id)

## schedule_items（TS: `scheduleItems`、legacy）

予定機能はアプリケーションから廃止済み。既存データの復元可能なバックアップと旧アプリ停止を確認した第2段階で、このテーブルと `schedule_kind` enum を削除する。

定義ファイル: `packages/shared/src/schema/schedule-items.ts`

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| date | date (string mode) | NOT NULL | — | |
| kind | schedule_kind (enum) | NOT NULL | 'other' | |
| name | text | NOT NULL | — | |
| location | text | NULL | — | |
| description | text | NULL | — | |
| owner_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

## event_line_broadcasts（TS: `eventLineBroadcasts`）

定義ファイル: `packages/shared/src/schema/event-line-broadcasts.ts`

イベント⇔LINEグループの1:1紐付け。ライフサイクル: `invite_pending → joined_waiting_code → linked → revoked/released`。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_id | integer | NOT NULL | — | UNIQUE。FK→events.id ON DELETE RESTRICT |
| line_channel_id | integer | NOT NULL | — | FK→line_channels.id ON DELETE RESTRICT |
| invite_code | text | NULL | — | 部分UNIQUE対象 |
| invite_code_expires_at | timestamptz | NULL | — | |
| line_group_id | text | NULL | — | |
| status | event_line_broadcast_status (enum) | NOT NULL | 'invite_pending' | |
| linked_at | timestamptz | NULL | — | |
| extended_until | date (string mode) | NULL | — | 自動解放期限の運用者延長 |
| released_at | timestamptz | NULL | — | |
| revoked_at | timestamptz | NULL | — | |
| revoke_reason | text | NULL | — | 自由記述（manual/bot_kicked/channel_disabled等） |
| guidelines_sent_at | timestamptz | NULL | — | 紐付け完了時に選択済み要綱を push した最終日時（監査/表示用）。未送信・再発行後はNULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(event_id) / 部分UNIQUE `event_line_broadcasts_invite_code_active_uq` on (invite_code) WHERE invite_code IS NOT NULL

## event_broadcast_messages（TS: `eventBroadcastMessages`）

定義ファイル: `packages/shared/src/schema/event-broadcast-messages.ts`

1メール→1LINEグループ配信 = 1行。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_line_broadcast_id | integer | NOT NULL | — | FK→event_line_broadcasts.id ON DELETE CASCADE |
| mail_message_id | integer | NOT NULL | — | FK→mail_messages.id ON DELETE RESTRICT |
| status | event_broadcast_message_status (enum) | NOT NULL | 'pending' | |
| is_correction | boolean | NOT NULL | false | |
| lead_text | text | NULL | — | 手動配信の見出し文（再配信用に保存） |
| sent_lead_count | integer | NOT NULL | 0 | |
| sent_text_count | integer | NOT NULL | 0 | |
| sent_image_count | integer | NOT NULL | 0 | |
| fallback_link_count | integer | NOT NULL | 0 | 署名URLフォールバックした添付数 |
| error_message | text | NULL | — | |
| sent_at | timestamptz | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `event_broadcast_messages_broadcast_mail_uq` on (event_line_broadcast_id, mail_message_id)

## event_broadcast_guideline_attachments（TS: `eventBroadcastGuidelineAttachments`）

定義ファイル: `packages/shared/src/schema/event-broadcast-guideline-attachments.ts`

招待コード発行モーダルで管理者が「要綱として送信するファイル」に選んだ添付を、対象イベントのLINE連携（`event_line_broadcasts`, 1 event = 1 行）に紐づけて保持するjoinテーブル。紐付け完了（linked）時に選択済み添付だけが署名URLリンクでLINEグループへpushされる（broadcast-guidelines-on-link）。招待コード再発行は同一`event_line_broadcasts`行のUPDATE（id保持）なので選択は再発行をまたいで保持される。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_line_broadcast_id | integer | NOT NULL | — | FK→event_line_broadcasts.id ON DELETE CASCADE |
| mail_attachment_id | integer | NOT NULL | — | FK→mail_attachments.id ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `event_broadcast_guideline_attachments_uq` on (event_line_broadcast_id, mail_attachment_id) / INDEX `event_broadcast_guideline_attachments_mail_attachment_idx` on (mail_attachment_id)（FK ON DELETE CASCADE のカスケード探索用）

## event_lifecycle_notifications（TS: `eventLifecycleNotifications`）

定義ファイル: `packages/shared/src/schema/event-lifecycle-notifications.ts`

会レベルの申込/支払いライフサイクルLINE通知のonce-everログ。`(event_id, type)`のUNIQUEが「一度だけ送る」を保証する。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_id | integer | NOT NULL | — | FK→events.id ON DELETE CASCADE |
| type | event_lifecycle_notification_type (enum) | NOT NULL | — | |
| status | event_lifecycle_notification_status (enum) | NOT NULL | 'sent' | |
| line_group_id | text | NULL | — | 送信時点の宛先グループ（監査用） |
| error_message | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `event_lifecycle_notifications_event_type_uq` on (event_id, type)
