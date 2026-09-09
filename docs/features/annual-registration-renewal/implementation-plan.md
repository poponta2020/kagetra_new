---
status: completed
---
# annual-registration-renewal 実装手順書

要件＝`requirements.md`（AC は §4）、見た目＝`design-spec.md`＋`design-mock/`（Path D・`design_source: claude-design`。忠実度チェックリストは design-spec §8）。本書は薄く保つ（詳細はコードベースが正）。技術設計は 2026-09-09 に deep-advisor へ相談して確定した。

## 技術設計（確定）

### データモデル（migration 0066・`packages/shared/src/schema/`）
- **`users` 追加列**: `reader_certification`（enum `reader_certification` = 'B' | 'A'、NULL＝なし）・`is_associate_referee boolean NOT NULL DEFAULT false`。スナップショット対象外（名簿の写しで現在値を表示するだけ）
- **`line_channel_purpose` に `'club_chat'` を追加**。転換は `UPDATE line_channels SET purpose='club_chat', status='assigned' WHERE purpose='event_broadcast' AND status='available' AND assigned_entry_group_id IS NULL … RETURNING`（級グループと同形の CAS。status を available から外さないと大会側 `reserveAvailableChannel` が同じ Bot を取る）。`status='system'` は流用しない（`loadSystemChannel` が壊れる）。★migration では `ADD VALUE` と同じファイル内で `'club_chat'` を値として使わない
- **`club_line_groups`**（実質 1 行）: `id`・`line_channel_id UNIQUE FK(line_channels) RESTRICT`・`oam_account_path`（U…）・`oam_chat_room_id`（C…）・`chat_room_name`・`line_group_id`（webhook 側 C…・NULL 可）・`line_group_captured_at`・`updated_by`・timestamps
- **`membership_renewals`**: `id`・`fiscal_year int UNIQUE`・`deadline date`・`note text`・`status` enum `membership_renewal_status`('open'|'completed')・`started_by FK users SET NULL`・`started_at`・`completed_at`・`completed_by`
- **`membership_renewal_members`**: `id`・`renewal_id FK CASCADE`・`user_id FK users **CASCADE**`（誤登録リカバリの `deleteMember` を塞がない）・UNIQUE(renewal_id, user_id)・`is_zennichikyo_target bool`・`is_circle_target bool`・`snapshot jsonb NOT NULL $type<RenewalSnapshot>`（`v: 1`・R2 の項目を全て `T | null` で明示・zod で読み出し検証）・`answer` enum `renewal_answer`('register'|'not_register') NULL・`answered_at`・`answered_by_user_id FK SET NULL`・`answered_by_admin bool`・学年回答は**絶対値**で保存: `school_year_kind` enum `renewal_school_year_kind`('advance'|'custom'|'leave') NULL・`next_faculty_kind`・`next_faculty`・`next_school_year`・`school_year_answered_at`・`school_year_applied_at`
- **`line_chat_tasks`**: `id`・`renewal_id FK CASCADE`・`kind` enum `line_chat_task_kind`('announcement'|'reminder')・`target_date date`・`split_index int NOT NULL DEFAULT 0`・`scheduled_send_at timestamptz`（導出: 案内＝作成時刻+15分を 10 分境界へ切り上げ／リマインド＝target_date 20:00 JST + 10min×split_index。同 renewal の未取消タスクと同時刻なら次の枠へ）・`message_text`（完成形＝氏名テキスト列挙済み）・`mentions jsonb`（`[{displayName, placeholder}]`）・`target_user_ids jsonb`・`status` enum `line_chat_task_status`('PENDING'|'RESERVING'|'RESERVED'|'FAILED'|'MANUAL_REVIEW_REQUIRED'|'DRY_RUN_SUCCEEDED'|'CANCEL_PENDING'|'CANCELLED')・`error_code`・`error_message`・`mention_result jsonb`・`reserving_at`・timestamps。**部分 UNIQUE `(renewal_id, kind, target_date, split_index) WHERE status <> 'CANCELLED'`**
- 保持: スナップショットは users と同じ PII 扱い（削除しない・RSC で本人／admin 以外へ渡さない）。タスク行に載せるのは氏名のみ

### 純ロジック（`apps/web/src/lib/membership-renewal/`・DB 非依存）
- `membership-kind.ts`: 正会員／准会員（対象年度の 3/31 時点で満 20 歳）。NULL は 'unknown'
- `snapshot.ts` / `diff.ts`: `ROSTER_FIELDS` 固定配列（姓・名・姓かな・名かな・生年月日・性別・段位・級・郵便番号・住所1・住所2・電話）で snapshot 生成と差分（キー欠落＝null、郵便番号は 7 桁正規化で比較）
- `school-year.ts`: 既定 +1（`schoolYearOptions(kind)` の順）・最終学年判定（学部＝`SIX_YEAR_FACULTIES`（医・歯・薬・獣医）なら 6 年、他は 4 年／修士 2 年／博士 3 年／専門職 3 年）・`resolveSchoolYearApply(answer, todayJst, fiscalYear) → patch | null`（4/1 以降のみ patch。`leave` は `is_circle_member=false`）
- `schedule.ts`: 対象日集合（開始日+3n・締切前日・締切当日、締切超過なし）・次のリマインド日・案内／リマインドの送信時刻（10 分境界・マージン 5 分・衝突回避）・分割（上限＝設定値、既定 20）
- `messages.ts`: 案内／リマインドの固定テンプレ（締切 `M/D(曜)`・URL・一言・氏名列挙）。案内文には「ログイン後はホームの『登録確認』から開けます」を含める（ログイン後の戻り先は既存フローで実現しないため）
- `dan-kanji.ts`: 段位の漢数字（四段・参段・弐段・初段）
- `authz.ts`: `isRenewalAdmin(session)`（admin / vice_admin）

### 定期実行（`apps/web/scripts/renewal-daily.ts`・systemd 2 本）
- `--reminders`（`kagetra-renewal-reminders.timer` 19:30 JST・Persistent）: ①reconcile（RESERVING が 30 分超→MANUAL_REVIEW_REQUIRED、送信時刻−5 分を過ぎた PENDING→FAILED `PENDING_EXPIRED`）②今日が対象日で (renewal,'reminder',today) の行が無く、全日協未回答者（退会処理済み除外）が 1 人以上なら、表示名を解決して分割タスクを作る。`now` が 20:00−5 分を過ぎていたら作らずログ（catch-up 対策）
- `--apply-school-year`（`kagetra-renewal-school-year.timer` 00:05 JST）: `school_year_applied_at IS NULL AND 対象年度の 4/1 <= today` の行を `UPDATE … WHERE school_year_applied_at IS NULL` の CAS で反映（renewal の status は見ない）
- 回答 Action は保存後に同 tx で `resolveSchoolYearApply` を呼ぶ（4/1 以降の回答は即時反映）。反映後の管理者編集はバッチが触らない／反映前の管理者編集は 4/1 に本人の絶対値で上書き（受容・技術計画で確定）

### ワーカー契約（`/api/line-chat-worker/**`・match-tracker `line-chat-worker` 互換）
- 認証 `X-Service-Token` ＝ env `LINE_CHAT_WORKER_TOKEN`（kagetra 専用・`verifyExternalApiKey` と同形の timingSafeEqual・fail-closed）。middleware matcher から除外
- `GET /tasks` → `WorkerTask[]`: `{ id, status: 'PENDING'|'CANCEL_PENDING', chatRoomId, chatRoomName, scheduledSendAt (ISO +09:00), messageText, mentions?: [{displayName, placeholder}] }`。`broadcastGroupId`/`sessionId` は返さない（ワーカー側で optional 化）。送信時刻−5 分を過ぎた行は返さない。S3 未設定なら空
- `POST /{id}/result` → `{ status, errorCode?, errorMessage?, mentionResult?: {matched[], unmatched[]} }`。遷移: PENDING→RESERVING→RESERVED|FAILED|MANUAL_REVIEW_REQUIRED|DRY_RUN_SUCCEEDED、CANCEL_PENDING→CANCELLED。不正遷移 409
- `POST /session-warning` → 管理者個人 LINE（`pushSystemText`）へ中継。FAILED / MANUAL_REVIEW_REQUIRED の報告時も同じ経路で通知
- 再試行＝同じ行を FAILED→PENDING（送信時刻が未来のときのみ）。締切変更・登録完了の取消＝PENDING→CANCELLED、RESERVED→CANCEL_PENDING、RESERVING は触らない。PENDING の案内は本文・時刻をその場で書き換えてよい
- メンション: `messageText` は全員を氏名テキストで列挙した完成形。ワーカーは `placeholder`（本文中の氏名文字列）を `@候補選択` に置き換え、一致しなければテキストのまま＝契約レベルでフォールバックが成立。旧ワーカー／`mentions` 無しでも本文をそのままタイプ

### match-tracker 側（別リポジトリ・タスク 11）
- `loadConfig`: 既存 env を app[0] とし `APPS_JSON='[{name, baseUrl, token, accountPath, dryRun?}]'` を追加分として結合。context は 1 つ、`OamChatPage` はアプリごと 1 インスタンス、`runCycle` をアプリ順に直列。session-warning は全アプリへ
- `WorkerTask.broadcastGroupId / sessionId` を optional に。`mentions` と `mentionResult` を追加
- `OamChatPage.inputMessageWithMentions`: `@`＋表示名で候補を選ぶ。**PoC で `INPUT_ECHO_MISMATCH` 検証（textarea value と本文の完全一致）がメンション挿入後にどう振る舞うかを先に実測**し、必要なら placeholder を除いた比較へ緩める

### その他の確定事項
- `users.name`（合成表示名）は S1 で再合成しない（既存 3 経路と同じ）。紐付け済み会員の表示名変更は別 Issue（Non-goal に追記済み）
- 退会処理済みの対象者は集計・メンション・登録完了のフラグ更新の全てから外す
- 締切変更の日程は導出（保存しない）。取消は「未取消タスクのうち target_date が新しい対象日集合に無いもの」だけ
- `PUBLIC_BASE_URL` の解決は既存ヘルパー（`lib/travel-report/notify.ts` 等）を import する
- ゲストは `/renewal` の許可リストに入れない（対象外）
- 転換前のプール Bot で join を試さない（`club_line_groups.line_channel_id = channelId` だけで捕捉するため）

## 実装タスク

### タスク1: スキーマ・migration 0066・共有型
- [x] 完了
- **目的:** 上記データモデルを Drizzle で定義し migration を生成。`RenewalSnapshot` 型・`ROSTER_FIELDS`・`SIX_YEAR_FACULTIES`・enum 型を `packages/shared` に置く（**zod は置かない** —— `packages/shared` は zod に依存しない。検証は `travel_routes.legs` と同じく Server Action 境界＝タスク2 の `snapshot.ts`）
- **対応AC:** AC-1〜3・AC-21・AC-24・AC-27 の土台
- **主な変更領域:** `packages/shared/src/schema/{enums,auth,line-channels?,membership-renewals,membership-renewal-members,line-chat-tasks,club-line-groups,index,relations}.ts`・`packages/shared/src/constants/membership-renewal.ts`・`packages/shared/src/types`・`packages/shared/drizzle/0066_*.sql`・`docs/design/db.md`＋`db-tables-auth-line.md`
- **依存タスク:** なし（main が担当。migration 生成を含む）
- **必要なテスト:** スキーマ定義とマイグレーション SQL の照合（`packages/shared` は zod に依存しないので **snapshot の zod は タスク2 へ移した**。部分 UNIQUE が CANCELLED 行の再作成を許すことの **DB 実挙動は タスク4** のタスク store テストで見る —— `packages/shared` の vitest は DB を持たない）
- **完了条件:** `pnpm db:generate` の差分が設計どおり・`pnpm check-types` 通過・`packages/shared` テスト green
- **結果:** migration `0066_minor_black_bolt.sql` を生成。`club_chat` はファイル内で `ADD VALUE` の 1 行にしか現れない（PG は同一 tx で新しい enum 値を使えない）。`packages/shared` テスト 102 件 green・`check-types` 通過
- **対応Issue:** #620

### タスク2: 純ロジック（membership-kind / snapshot / diff / school-year / schedule / messages / dan-kanji / authz）
- [ ] 完了
- **目的:** DB 非依存の判定・導出・文面を純関数で固める（S1・S2・バッチ・API が共用）
- **対応AC:** AC-4・AC-7（差分）・AC-11・AC-12（判定部）・AC-15（対象日）・AC-16/16b（文面・分割）・AC-17（再計算）
- **主な変更領域:** `apps/web/src/lib/membership-renewal/{membership-kind,snapshot,diff,school-year,schedule,messages,dan-kanji,authz}.ts`＋各 `.test.ts`（`snapshot.ts` に `RenewalSnapshot` の zod parse/reject を含む）
- **依存タスク:** タスク1
- **必要なテスト:** 3/31・4/1 の境界／NULL／郵便番号正規化／最終学年 4 種＋6 年制／`resolveSchoolYearApply` の 4/1 前後／対象日集合（締切前日と 3 日おきの重なり・締切超過）／分割と衝突回避／テンプレに中括弧・URL・締切が入る
- **完了条件:** テスト green・lint 通過
- **対応Issue:** #621

### タスク3: S3 会 LINE グループ設定・Bot 転換・webhook の join 捕捉
- [ ] 完了
- **目的:** `/settings/club-line-group`（design-spec S3）と `club_line_groups` の保存、Bot の CAS 転換／復帰、webhook の `club_chat` 分岐（join で `line_group_id` 捕捉・leave で NULL 化・発言無視・reply なし）
- **対応AC:** AC-24・AC-25・AC-26
- **主な変更領域:** `apps/web/src/app/(app)/settings/club-line-group/{page,actions,ClubLineGroupForm}.tsx`・`apps/web/src/lib/club-line-group.ts`（load/save/parseOamRoomUrl/convertBot/revertBot）・`apps/web/src/lib/line-webhook-handler.ts`（`IN` リストに `'club_chat'`＋`applyClubChatWebhookEvents`）・`apps/web/src/app/(app)/settings/page.tsx`（導線）
- **依存タスク:** タスク1。**タスク4 とは変更領域が重ならない**（webhook ハンドラ vs api route）
- **必要なテスト:** URL パース（正常・不正・人数括弧）／転換 CAS（available でない Bot は失敗）／復帰は進行中 renewal・未終了タスクがあれば拒否／webhook: join で捕捉・leave で NULL・text 無視・既存 event/grade ハンドラへ流れない
- **完了条件:** テスト green・S3 の 2 状態が design-spec どおり
- **対応Issue:** #622

### タスク4: 送信タスク store・ワーカー API・管理者通知の中継
- [ ] 完了
- **目的:** `line_chat_tasks` の作成／遷移／取消／再試行を 1 モジュールに集約し、`/api/line-chat-worker/{tasks,[id]/result,session-warning}` をサービストークンで提供。FAILED／要確認／session-warning を `pushSystemText` で管理者へ
- **対応AC:** AC-21・AC-22・AC-23・AC-16c（失敗理由の記録）
- **主な変更領域:** `apps/web/src/lib/line-chat-tasks.ts`・`apps/web/src/lib/line-chat-worker-token.ts`・`apps/web/src/app/api/line-chat-worker/{tasks,[id]/result,session-warning}/route.ts`・`apps/web/src/middleware.ts`（matcher 除外）・`docs/spec/notifications.md`（契約）
- **依存タスク:** タスク1
- **必要なテスト:** 401/403/200・tasks が PENDING/CANCEL_PENDING だけ＆送信時刻−5 分超過を返さない・`WorkerTask` 形（`broadcastGroupId` を含まない）・遷移表と 409・`mentionResult` 保存・通知の呼び出し（push はモック）
- **完了条件:** テスト green・セッション認可エンドポイントにトークンで入れないことの回帰
- **対応Issue:** #623

### タスク5: 年度確認 store と Server Actions（開始・回答・代理回答・締切変更・登録完了）
- [ ] 完了
- **目的:** `membership_renewals`／`_members` の store と Action 群。開始（対象者確定＋スナップショット＋案内タスクを 1 tx）・本人回答（名簿の列の一括保存＝既存会員編集と同じ検証・`name` 不変・学年の絶対値保存＋4/1 以降即時反映）・代理回答・締切変更（日程再計算と取消）・登録完了（フラグ OFF・取消・完了）
- **対応AC:** AC-1・2・3・5・6・8・9・12（即時反映）・14・17・18・19
- **主な変更領域:** `apps/web/src/lib/membership-renewal/store.ts`・`apps/web/src/app/(app)/renewal/actions.ts`・`apps/web/src/app/(app)/admin/members/renewal/actions.ts`
- **依存タスク:** タスク1・2・4
- **必要なテスト:** DB-backed。対象者確定の条件・開始拒否 4 条件・tx 原子性・必須欠落で「登録する」が拒否／「登録しない」は可・他人 id で不可・差分導出・代理回答の記録・締切変更で取消される行とされない行・登録完了の効果（退会処理済みはフラグ不変）
- **完了条件:** テスト green
- **対応Issue:** #624

### タスク6: S1 会員画面 `/renewal` ＋ S4 ホームのバナー
- [ ] 完了
- **目的:** design-spec S1（回答状態バー・2 択カード・名簿の列の行内修正・学年 1 行／最終学年 3 択・回答済みの前→後）と S4（`RenewalAlertRow`）の実装
- **対応AC:** AC-5（表示）・AC-10・AC-11（UI）・AC-20・AC-28
- **主な変更領域:** `apps/web/src/app/(app)/renewal/{page,RenewalForm,...}.tsx`・`apps/web/src/components/membership-renewal/*`・`apps/web/src/app/(app)/dashboard/{page,HomeTimeline,home-timeline-types}.tsx`・`apps/web/src/lib/membership-renewal/alerts.ts`・`guest-access`（許可しない）
- **依存タスク:** タスク5。**タスク8・9 とは領域が重ならない**
- **必要なテスト:** page（対象外・両セクション・片方）・行内修正の状態遷移・必須欠落でボタン無効・最終学年で 3 択・バナーの出る／消える条件（jsdom・素の DOM）
- **完了条件:** テスト green・`design-mock/renewal-member.html` と同じトークン・要素順（design-spec §8）
- **対応Issue:** #625

### タスク7: S5 会員編集の公認資格
- [ ] 完了
- **目的:** `/admin/members/[id]/edit` に 読手（なし／B級公認／A級公認）と 準公認審判員 を追加
- **対応AC:** AC-27（編集部分）
- **主な変更領域:** `apps/web/src/app/(app)/admin/members/[id]/edit/{actions,edit-member-form}.tsx`・`docs/spec/auth-admin.md`
- **依存タスク:** タスク1。他タスクと領域が重ならない
- **必要なテスト:** zod（不正値拒否）・保存と読み戻し・既存プロフィール項目の回帰
- **完了条件:** テスト green
- **対応Issue:** #626

### タスク8: 日次バッチ（リマインド作成・reconcile・学年反映）・表示名解決・systemd
- [ ] 完了
- **目的:** `scripts/renewal-daily.ts --reminders | --apply-school-year`、`lib/membership-renewal/reminders.ts`（未回答者集計→表示名解決→分割→タスク作成）、`lib/line-group-membership.ts` に表示名取得を追加、systemd unit 2 組、`docs/deploy/annual-registration-renewal.md`
- **対応AC:** AC-12（バッチ）・AC-15・AC-16・AC-16b・AC-16c
- **主な変更領域:** `apps/web/scripts/renewal-daily.ts`・`apps/web/src/lib/membership-renewal/reminders.ts`・`apps/web/src/lib/membership-renewal/apply-school-year.ts`・`apps/web/src/lib/line-group-membership.ts`・`apps/web/systemd/kagetra-renewal-{reminders,school-year}.{service,timer}`・`docs/deploy/annual-registration-renewal.md`
- **依存タスク:** タスク5（未回答者・対象者の照会）・タスク3（グループ ID）・タスク4（タスク store）
- **必要なテスト:** `now` 注入で 対象日／非対象日／未回答 0／同日再実行／マージン超過／表示名 API 失敗→全員テキスト／分割件数／reconcile の 2 規則／学年反映の CAS と `applied_at`
- **完了条件:** テスト green・`--dry-run` で候補が出る
- **対応Issue:** #627

### タスク9: S2 管理ボード `/admin/members/renewal`
- [ ] 完了
- **目的:** design-spec S2（未開始フォーム＋前提チェック＋文面プレビュー／進行中の集計・4 タブ・区分別の名簿の写し・差分・代理回答・締切変更・登録完了ダイアログ／完了後の閲覧）と会員一覧からの導線
- **対応AC:** AC-7（表示）・AC-13・AC-14（UI）・AC-19（ダイアログ）・AC-28
- **主な変更領域:** `apps/web/src/app/(app)/admin/members/renewal/{page,RenewalBoard,StartForm,MemberRow,CompleteDialog,ProxyAnswerDialog}.tsx`・`apps/web/src/app/(app)/admin/members/page.tsx`（導線 1 行）
- **依存タスク:** タスク5。**タスク6・8 とは領域が重ならない**
- **必要なテスト:** page（3 状態）・タブ件数・区分見出し・差分行・退会印・ダイアログの 3 点・admin 以外は /403
- **完了条件:** テスト green・`design-mock/renewal-admin.html` と同じ要素順（design-spec §8）
- **対応Issue:** #628

### タスク10: docs・忠実度チェックリスト・回帰
- [ ] 完了
- **目的:** `docs/spec/membership-renewal.md` 新設＋`docs/SPECIFICATION.md` 索引、`notifications.md`（ワーカー経路）、`ui-shell.md`（設定ハブ）、`features/INDEX.md` の主要領域更新、design-spec §8 の全項目確認、`git grep` で PII・トークンのログ出力が無いこと
- **対応AC:** AC-28・AC-29
- **主な変更領域:** `docs/**`・design-spec.md
- **依存タスク:** タスク3〜9
- **必要なテスト:** 既存テスト・lint・typecheck（CI）
- **完了条件:** design-spec §8 全項目チェック・CI green
- **対応Issue:** #629

### タスク11: match-tracker ワーカーの複数アプリ対応＋メンション（別リポジトリ・main が手動）
- [ ] 完了
- **目的:** `line-chat-worker` に `APPS_JSON`（per-app dryRun）・optional な固有項目・`mentions`/`mentionResult`・`@` 候補選択の Page Object を追加し、テストグループで PoC（AC-31）→ VM の `.env` 更新→再起動
- **対応AC:** AC-30・AC-31・AC-32
- **主な変更領域:** `C:/Users/popon/match-tracker/line-chat-worker/src/{config,domain/types,appApi/client,index,line/pages/OamChatPage,usecases/reserveMessage}.ts`・RUNBOOK.md
- **依存タスク:** タスク4（契約）。kagetra 側の出荷をブロックしない（未デプロイの間はタスクが PENDING のまま）。**/implement の Wave では扱わない**（別リポジトリ）
- **必要なテスト:** match-tracker 側の vitest（複数アプリのループ・mentions 無しの後方互換・placeholder 置換）
- **完了条件:** PoC で `RESERVED`＋送信予定バナーにメンション、上限値を kagetra の設定値に反映
- **対応Issue:** #630

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1（main。スキーマ・migration・共有型）
- Wave 2: タスク2・タスク3・タスク4・タスク7（互いに変更領域が重ならない: 純ロジック／settings+webhook+lib/club-line-group／lib/line-chat-tasks+api route+middleware／admin 会員編集）
- Wave 3: タスク5（main。store と Action 群。複数レイヤー・認可を跨ぐ）
- Wave 4: タスク6・タスク8・タスク9（renewal 画面+dashboard／scripts+systemd+lib/reminders／admin/members/renewal）
- Wave 5: タスク10（main。docs・忠実度チェックリスト）
- 別レーン: タスク11（match-tracker。main が手動。kagetra の PR とは独立に出荷）

## 実装への申し送り
- **最初に確認する事実**: ローカル／CI のテスト DB がマイグレーションを 1 ファイル 1 tx で流すか（`ADD VALUE` と同一ファイル内の値使用を避ける根拠）／`deleteMember` の参照チェック（`admin/members/[id]/edit/actions.ts`）に新テーブルを足す必要が CASCADE で消えているか／進行中ブランチに 0066 が無いこと（2026-09-09 時点で無し）
- `design-mock/*.html` を正として移植する。**モックと同じトークン変数名**（`--kg-*`）を使い、値を読み取って書き直さない。ダイアログは既存の `createPortal`＋`.modal-overlay-h` パターン
- 「登録する」の必須検証は `register/[token]/actions.ts`・会員編集の zod を流用する（二重定義しない）。`name` は書かない
- 送信タスクは 19:30 作成→20:00 送信でマージン 5 分。match-tracker の 30 分ルールを写さない
- `pushSystemText` / `loadSystemChannel`（`lib/entry-overdue-alert.ts`）を再利用し、新しい push 実装を書かない
- 表示名取得は `line-group-membership.ts` の既存プローブと同じエンドポイント・タイムアウト。Bot 未在籍（グループ ID 未捕捉）なら全員テキスト（AC-16c）
- スナップショット・タスク行・ワーカー API のレスポンスに PII（住所・電話・生年月日）を混ぜない（氏名のみ）
- 新規 timer は `apps/web/systemd/kagetra-*.{service,timer}` に置けば `auto-deploy.sh` が自動配置する。`docs/deploy/annual-registration-renewal.md` に env（`LINE_CHAT_WORKER_TOKEN`）と初回確認手順を書く
- タスク11 の PoC 前に `OamChatPage.inputMessage` の echo 検証がメンション挿入後にどう振る舞うかを実測する
