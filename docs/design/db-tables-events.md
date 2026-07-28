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
| entry_status | event_entry_status (enum) | NOT NULL | 'not_applied' | `not_applied` / `applied` / `not_applying`（申込者なしで見送り。`/events` 一覧から除外され、申込締切リマインド・締切超過アラートの対象外） |
| entry_applied_at | timestamptz | NULL | — | |
| payment_type | event_payment_type (enum) | NULL | — | NULL=支払い通知なし |
| payment_status | event_payment_status (enum) | NOT NULL | 'unpaid' | `payment_type='advance'`時のみ意味を持つ |
| payment_paid_at | timestamptz | NULL | — | |
| tournament_draft_id | integer | NULL | — | AI取込元ドラフトへの参照。FK制約はmigrationのraw ALTERで付与（ON DELETE SET NULL） |
| tournament_draft_unit_key | text | NULL | — | ドラフトpayload内の該当イベント単位キー |
| grade_broadcast_attachment_id | integer | NULL | — | 級グループ告知に載せる要綱添付。承認フォームで1件選択（未選択=NULL→文面のURL行を省略）。FK→mail_attachments.idはmigrationのraw ALTERで付与（ON DELETE SET NULL） |
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

申込グループ（`entry_groups`）⇔LINEグループの1:1紐付け（entry-groups: 帰属は event → entry_group へ移した。1グループ=1LINEグループ=1Bot、グループ内のどの日の詳細画面から操作しても同一の紐付けに作用する）。ライフサイクル: `invite_pending → joined_waiting_code → linked → revoked/released`。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| entry_group_id | integer | NOT NULL | — | UNIQUE。FK→entry_groups.id ON DELETE RESTRICT |
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

**制約**: UNIQUE(entry_group_id) / 部分UNIQUE `event_line_broadcasts_invite_code_active_uq` on (invite_code) WHERE invite_code IS NOT NULL

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

招待コード発行モーダルで管理者が「要綱として送信するファイル」に選んだ添付を、対象申込グループのLINE連携（`event_line_broadcasts`, 1 entry_group = 1 行）に紐づけて保持するjoinテーブル。紐付け完了（linked）時に選択済み添付だけが署名URLリンクでLINEグループへpushされる（broadcast-guidelines-on-link）。招待コード再発行は同一`event_line_broadcasts`行のUPDATE（id保持）なので選択は再発行をまたいで保持される。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_line_broadcast_id | integer | NOT NULL | — | FK→event_line_broadcasts.id ON DELETE CASCADE |
| mail_attachment_id | integer | NOT NULL | — | FK→mail_attachments.id ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `event_broadcast_guideline_attachments_uq` on (event_line_broadcast_id, mail_attachment_id) / INDEX `event_broadcast_guideline_attachments_mail_attachment_idx` on (mail_attachment_id)（FK ON DELETE CASCADE のカスケード探索用）

## line_grade_group_bindings（TS: `lineGradeGroupBindings`）

定義ファイル: `packages/shared/src/schema/line-grade-group-bindings.ts`

級(A〜E)⇔級別LINEグループの**常設**1:1紐付け（event-grade-group-broadcast）。`event_line_broadcasts`は`entry_group_id`がNOT NULL+UNIQUEで大会（申込グループ）に属さない紐付けを表現できないため別テーブル。ライフサイクル: `invite_pending → joined_waiting_code → linked → revoked`（大会終了で解放される`released`は持たない）。**配信対象は`status='linked'`かつ`line_group_id IS NOT NULL`の行のみ**。push失敗でこの行を自動revokeしない。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| grade | grade (enum) | NOT NULL | — | UNIQUE（1級に2グループ不可） |
| line_channel_id | integer | NOT NULL | — | UNIQUE（1 Botが2級を兼務不可）。FK→line_channels.id ON DELETE RESTRICT |
| invite_code | text | NULL | — | 部分UNIQUE対象 |
| invite_code_expires_at | timestamptz | NULL | — | |
| line_group_id | text | NULL | — | join webhookで捕捉 |
| status | line_grade_group_status (enum) | NOT NULL | 'invite_pending' | |
| linked_at | timestamptz | NULL | — | |
| revoked_at | timestamptz | NULL | — | |
| revoke_reason | text | NULL | — | 自由記述（manual/bot_kicked） |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(grade) / UNIQUE(line_channel_id) / 部分UNIQUE `line_grade_group_bindings_invite_code_active_uq` on (invite_code) WHERE invite_code IS NOT NULL

## event_grade_broadcasts（TS: `eventGradeBroadcasts`）

定義ファイル: `packages/shared/src/schema/event-grade-broadcasts.ts`

`(大会, 級)`単位の級グループ配信記録。**claim → push → 確定/取消**方式で「二重送信しない」と「失敗した級は未送信のまま残して再送できる」を両立する。claimはリースつきupsert（`ON CONFLICT DO UPDATE ... WHERE sent_at IS NULL AND claimed_at < now() - interval '5 minutes' RETURNING id`）で、送信途中にプロセスが落ちても5分後に再claimできる。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| event_id | integer | NOT NULL | — | FK→events.id ON DELETE CASCADE |
| grade | grade (enum) | NOT NULL | — | |
| claimed_at | timestamptz | NOT NULL | `now()` | リースの基準時刻。確定/取消はこの値との一致（ownership CAS）を条件にする。JS の Date と往復させるためミリ秒に丸めて書く |
| retry_key | text | NULL | — | LINEの`X-Line-Retry-Key`(UUID)。**一度決めたら変えない**。同じpushにまとめた行が共有し、一部だけ再送しても元の送信と同じキーで再開できる |
| sent_at | timestamptz | NULL | — | push成功時のみ。NULL=claim中/放置claim |
| created_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE `event_grade_broadcasts_event_grade_uq` on (event_id, grade)

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

## entry_form_drafts（TS: `entryFormDrafts`）

定義ファイル: `packages/shared/src/schema/entry-form-drafts.ts`

申込書下書きの作成履歴（entry-form-autofill）。1作成=1行。行は IMAP APPEND 実行前に `pending` で保存し、成功したら `created`、失敗したら `imap_failed` に更新する（編集値と生成 xlsx を失わない）。挿入から更新までの間にプロセスが落ちた行は `pending` のまま残るので、「下書きが無いのに成功」の誤表示にならない。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| entry_group_id | integer | NOT NULL | — | FK→entry_groups.id ON DELETE CASCADE |
| created_by | text | NULL | — | FK→users.id ON DELETE SET NULL |
| to_email | text | NOT NULL | — | |
| subject | text | NOT NULL | — | |
| body | text | NOT NULL | — | |
| attachment_filename | text | NOT NULL | — | |
| message_id | text | NOT NULL | — | RFC 5322 Message-ID。APPEND の冪等キー（再試行で同じ値を使い、Draft を照合して二重作成を防ぐ） |
| xlsx | bytea | NOT NULL | — | 生成済み申込書のコピー（再ダウンロード用） |
| member_count | integer | NOT NULL | — | |
| status | entry_form_draft_status (enum) | NOT NULL | 'pending' | `pending`（未着手）/ `appending`（APPEND 実行中＝claim 済み。再試行の排他に使う）/ `created` / `imap_failed` |
| imap_error | text | NULL | — | |
| created_at | timestamptz | NOT NULL | `now()` | |

**インデックス**: `entry_form_drafts_group_created_idx` on (entry_group_id, created_at)（グループの最新行引き当て用）
