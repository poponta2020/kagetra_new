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
| is_treasurer | boolean | NOT NULL | false | 会計担当か。**`@会計` のメンション対象の識別専用で、認可判断には使わない**（会計の権限は副管理者と同一なので role='vice_admin' を併せて付与して運用する） |
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
| is_circle_member | boolean | NOT NULL | false | 北大かるた会サークルへの所属（travel-report）。ON のとき faculty_kind / faculty / school_year / phone / birth_date が必須（不変条件は Server Action 側で強制）。遠征届の対象者判定の第1条件 |
| faculty_kind | faculty_kind (enum) | NULL | — | 学部／大学院の区分。faculty の候補と school_year の選択肢を切り替える |
| faculty | text | NULL | — | 学部等名。候補つきの自由入力で候補外も保存できる。候補は `@kagetra/shared` の共有定数 |
| school_year | text | NULL | — | 学年（例「2年」「修士1年」）。届にそのまま出力するため enum にしない。名簿の並びは共有定数 `SCHOOL_YEAR_ORDER` |
| is_travel_report_submitter | boolean | NOT NULL | false | 副連絡責任者。**`is_treasurer` と違い認可に使う**（遠征届の操作権限そのもの。正典は `lib/travel-report/authz.ts`）。`@副連絡責任者` メンションの解決先も兼ねる。ゲストに付いても権限にはならない |
| is_circle_leader | boolean | NOT NULL | false | サークル長。**同時に1人だけ**（partial unique index）。届の「団体代表者」と「留守連絡先の既定」に使う |
| reader_certification | reader_certification (enum) | NULL | — | 公認資格・読手（B級公認／A級公認）。**NULL＝なし**。全日協の申請で決まるため管理者だけが編集する（本人は年度確認で読むだけ） |
| is_associate_referee | boolean | NOT NULL | false | 準公認審判員。読手と独立（両方持つ人がいる） |

**制約・インデックス**: PK(id) / UNIQUE(name) / UNIQUE(email) / UNIQUE(line_user_id) / CHECK `users_dan_range`（`dan BETWEEN 0 AND 9 OR dan IS NULL`） / UNIQUE INDEX `users_circle_leader_unique` on (is_circle_leader) WHERE is_circle_leader（サークル長を同時に1人へ制限する DB バックストップ）

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
| kind | registration_invite_kind (enum) | NOT NULL | 'member' | このリンクが作るロール。登録処理はトークンから引き直して分岐し、クライアント送信値では決めない |
| expires_at | timestamptz | NOT NULL | — | |
| created_by | text | NOT NULL | — | FK→users.id ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL | `now()` | |
| revoked_at | timestamptz | NULL | — | 手動失効 |

## line_channels（TS: `lineChannels`）

定義ファイル: `packages/shared/src/schema/line-channels.ts`

LINE Messaging APIチャネルのプール。`purpose`で`system_notify`（単一・管理者通知用）/`event_broadcast`（30Botプール・申込グループごとに`assigned_entry_group_id`で予約）/`grade_broadcast`（級別グループ常設）/`club_chat`（会 LINE グループ。年度確認の案内・リマインドを OAM のチャット予約送信で流す）を区分。`club_chat` への転換は `purpose` と `status`（→`assigned`）を同時に動かす CAS で行う（大会側の予約が `status='available'` で候補を取るため、`purpose` だけ変えても同じ Bot を取られる）。

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

## app_settings（TS: `appSettings`）

定義ファイル: `packages/shared/src/schema/app-settings.ts`

汎用 key-value の会定数ストア（entry-form-autofill で新設）。最初の用途は申込書ヘッダ・申込メールに使う会の定数6項目（都道府県／所属会名／申込責任者氏名／連絡先電話／連絡先 E-Mail／振込名義人）。キー定義と型付き get/set は `apps/web/src/lib/entry-form/settings.ts`。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| key | text | NOT NULL | — | PK |
| value | text | NOT NULL | — | |
| updated_at | timestamptz | NOT NULL | `now()` | |
| updated_by | text | NULL | — | FK→users.id ON DELETE SET NULL |

## club_line_groups（TS: `clubLineGroups`）

定義ファイル: `packages/shared/src/schema/club-line-groups.ts`

会 LINE グループ（登録会員全員が居るグループ）の設定（annual-registration-renewal）。実質1行のシングルトン。**ID を2系統持つ**のが要点で、`oam_chat_room_id` は OAM 側のルーム ID（ワーカーが Playwright で開く先）、`line_group_id` は Messaging API の webhook が送ってくるグループ ID（メンション解決の表示名取得に使う）で**別の値**。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| line_channel_id | integer | NOT NULL | — | UNIQUE。FK→line_channels.id **ON DELETE RESTRICT**（設定が生きている Bot を消せない） |
| oam_account_path | text | NOT NULL | — | OAM のアカウントパス（`U`+32hex）。ルーム URL から取り出す |
| oam_chat_room_id | text | NOT NULL | — | OAM のチャットルーム ID（`C`+32hex）。ルーム URL から取り出す |
| chat_room_name | text | NOT NULL | — | OAM の見出しと**完全一致**する表示名（人数の括弧を含めない） |
| line_group_id | text | NULL | — | webhook 側のグループ ID。Bot 招待の `join` で捕捉するまで NULL（未捕捉ならリマインドは全員テキスト列挙） |
| line_group_captured_at | timestamptz | NULL | — | 捕捉日時 |
| updated_by | text | NULL | — | FK→users.id ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(line_channel_id)

## membership_renewals（TS: `membershipRenewals`）

定義ファイル: `packages/shared/src/schema/membership-renewals.ts`

年度確認1回分（annual-registration-renewal）。`fiscal_year` の UNIQUE が「同一年度を2回開始できない」を DB 層で保証する。「同時に進行できるのは1つ」は開始 Action の tx 内で確認する（部分 UNIQUE にしない）。リマインドの日程は保存せず、開始日と締切から都度導出する。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| fiscal_year | integer | NOT NULL | — | UNIQUE |
| deadline | date | NOT NULL | — | 回答締切（JST）。開始後も変更できる |
| note | text | NULL | — | 案内文に添える管理者の一言（200字まで） |
| status | membership_renewal_status (enum) | NOT NULL | 'open' | 完了は取り消せない |
| started_by | text | NULL | — | FK→users.id ON DELETE SET NULL |
| started_at | timestamptz | NOT NULL | `now()` | リマインド対象日（開始+3n日）の起点 |
| completed_at | timestamptz | NULL | — | |
| completed_by | text | NULL | — | FK→users.id ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(fiscal_year)

## membership_renewal_members（TS: `membershipRenewalMembers`）

定義ファイル: `packages/shared/src/schema/membership-renewal-members.ts`

年度確認の対象者1人分。対象集合は**開始時点で確定**し、以後 `users` のフラグが動いても行は増減しない（集計の母数を固定するため）。`user_id` を CASCADE にしているのは意図的で、誤登録リカバリの会員物理削除（`deleteMember`）をこの行が塞がないようにしている（「参照があれば拒否」の既存リストにもこのテーブルは足さない）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| renewal_id | integer | NOT NULL | — | FK→membership_renewals.id ON DELETE CASCADE |
| user_id | text | NOT NULL | — | FK→users.id **ON DELETE CASCADE**（誤登録リカバリを塞がない） |
| is_zennichikyo_target | boolean | NOT NULL | false | 開始時に `zen_nichikyo` だった |
| is_circle_target | boolean | NOT NULL | false | 開始時に `is_circle_member` だった |
| snapshot | jsonb | NOT NULL | — | 開始時の名簿の列＋学年（差分の基準）。キー固定・値が無い項目も `null` を明示。**住所・電話・生年月日を含む PII**（`users` と同じ扱い） |
| answer | renewal_answer (enum) | NULL | — | 未回答は NULL。登録完了まで何度でも上書き |
| answered_at | timestamptz | NULL | — | |
| answered_by_user_id | text | NULL | — | FK→users.id ON DELETE SET NULL |
| answered_by_admin | boolean | NOT NULL | false | 代理回答の区別 |
| school_year_kind | renewal_school_year_kind (enum) | NULL | — | advance / custom / leave |
| next_faculty_kind | faculty_kind (enum) | NULL | — | 進学時のみ |
| next_faculty | text | NULL | — | 進学時のみ |
| next_school_year | text | NULL | — | 反映する学年の**絶対値**（種別から再計算しない） |
| school_year_answered_at | timestamptz | NULL | — | |
| school_year_applied_at | timestamptz | NULL | — | `users` へ反映した日時。NULL＝未反映。4/1 の反映と即時反映がこの NULL を条件にした CAS で二重反映を防ぐ |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE(renewal_id, user_id)

## line_chat_tasks（TS: `lineChatTasks`）

定義ファイル: `packages/shared/src/schema/line-chat-tasks.ts`

会 LINE グループへの OAM チャット予約送信タスク。match-tracker の `line-chat-worker`（Playwright 常駐・同一 VM）が `/api/line-chat-worker/tasks` をポーリングして予約し、結果を報告する。`status` の値はワーカーの公開契約に合わせた**大文字**。載せてよい個人情報は**氏名だけ**（住所・電話・生年月日を混ぜない）。

| カラム名 (DB) | 型 | NULL | デフォルト | 制約・備考 |
|---|---|---|---|---|
| id | integer | NOT NULL | identity | PK |
| renewal_id | integer | NOT NULL | — | FK→membership_renewals.id ON DELETE CASCADE |
| kind | line_chat_task_kind (enum) | NOT NULL | — | announcement / reminder |
| target_date | date | NOT NULL | — | 送信の対象日（JST）。冪等キーの一部 |
| split_index | integer | NOT NULL | 0 | メンション上限超過で 10 分ずらして分割した番号 |
| scheduled_send_at | timestamptz | NOT NULL | — | 10分境界・未来。導出は呼び出し側（`schedule.ts`）が持ち、store は保存するだけ |
| message_text | text | NOT NULL | — | 生成時に確定した完成形（送信時に再計算しない） |
| mentions | jsonb | NOT NULL | `'[]'` | `[{displayName, placeholder}]`。解決できなければ空配列＝本文のテキスト列挙のまま |
| target_user_ids | jsonb | NOT NULL | `'[]'` | 名指しした対象者の `users.id`（「リマインドに載った回数」の集計元） |
| status | line_chat_task_status (enum) | NOT NULL | 'PENDING' | |
| error_code | text | NULL | — | ワーカー報告の失敗コード（`PENDING_EXPIRED` はアプリ側で書く） |
| error_message | text | NULL | — | |
| mention_result | jsonb | NULL | — | `{matched, unmatched}` |
| reserving_at | timestamptz | NULL | — | RESERVING に入った時刻（30分超で要確認へ倒す reconcile の判定） |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

**制約**: UNIQUE INDEX `line_chat_tasks_slot_uq` on (renewal_id, kind, target_date, split_index) **WHERE status <> 'CANCELLED'**（同日の二重作成を防ぎつつ、取り消した日を作り直せる。再試行は新規行ではなく同じ行を PENDING へ戻す）
