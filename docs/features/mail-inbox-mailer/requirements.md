---
status: completed
---
# mail-inbox-mailer 要件定義書

## 1. 概要

### 目的
現在の mail-inbox 画面を「AI が事前に大会案内を見つけて自動でドラフトを作っておく」モデルから、「**届いたメールは全部 inbox に並ぶ＝アプリがメーラー**」モデルに作り替える。AI 抽出は管理者が「これは会に流す」と明確に意思決定したメールに対してのみ起動する。

### 背景・動機
- 現状の AI 自動分類はメールの抜け漏れリスクがある（pre-filter のメルマガ誤判定、AI noise 判定の取りこぼし）
- 管理者は「結局メールを全部見てから判断したい」状態。事前 AI が判断を奪っているのが逆にストレス
- AI は「面倒な抽出作業の自動化道具」であるべきで、「振り分け判断者」ではない
- コスト面でも、全メールを毎回 AI 通すより、管理者が指定したメールだけ抽出する方が圧倒的に安い

## 2. ユーザーストーリー

### 対象ユーザー
- 会の管理者（poponta2020 さん）。副管理者も含む

### ユーザーの目的
- 受信したメールを取りこぼさず全件確認したい
- 「これは会に流す大会案内だ」と判断したメールに対してだけ AI 抽出を起動して、楽に下書きを作りたい
- 「組合せ表」「会場案内」のような既存大会への補足情報も、結びつけて LINE で流したい
- 「会計の領収書」「個人連絡」のような会向け配信不要なメールは、未処理バッジから消すだけにしたい

### 利用シナリオ
1. 30 分ごとの IMAP fetch でメールが届く → Web Push でバッジ通知
2. 管理者がアプリを開く → mail-inbox にメールが時系列で並んでいる（メーラー風）
3. メールを開く → 内容を読む（本文はトグル不要で即座に表示）
4. 3 つのうちひとつを選ぶ：
   - **(a) AI 大会抽出**: 「会で流す」と決めたメール → AI 抽出をバックグラウンド起動 → 完了したら Web Push で通知 → draft フォームで確認 → 承認 → LINE 配信
   - **(b) 既存イベント結びつけ**: 「組合せ表」「訂正版」などの補足情報 → 既存の大会を選んで紐付け → LINE で補足として配信
   - **(c) 対応不要**: 「領収書」「個人連絡」など → 未処理バッジから外すだけ
5. 「保留」は廃止（処理しないこと自体が保留を意味する）
6. 処理を間違えたら処理済セクションで「未処理に戻す」ボタンで undo

## 3. 機能要件

### 3.1 画面仕様

#### 3.1.1 mail-inbox 一覧画面（/admin/mail-inbox）
- 現状の一覧レイアウトを維持
- 並び順: 未処理セクションを上に集めて受信時間降順、処理済セクションはトグルで隠して最新 20 件を表示
- カードレイアウト: 差出人、件名、本文プレビュー、受信日、添付バッジ（現状維持）
- pre-filter で noise フラグ付きのメールも一覧に表示（現状の「noise 非表示」フィルタを外す）
- 未処理カウントヘッダ + Web Push でリアルタイム更新（既存仕組み）

#### 3.1.2 mail 詳細画面（/admin/mail-inbox/[id]）
- 本文を即座に表示（現状のトグルボタンを廃止）
- 上部: 件名 / 送信者 / 受信日 / 添付一覧
- 中部: 本文（HTML or text）
- 下部: アクションエリア（3 ボタン）
  - **会で流す（AI 抽出）** — 確認ダイアログ「AI で抽出します、よろしいですか？」→ 「はい」で draft INSERT (status=ai_processing) → 「AI 抽出中…」のカード表示
  - **既存イベントに紐付ける** — モーダル/シート起動 → 紐付け確定 → LINE 配信
  - **対応不要** — triage_status='processed' → 一覧画面に自動戻り

#### 3.1.3 AI 抽出処理中の表示
- 同じ詳細画面に「AI 抽出中… 完了したら通知します」のカード表示（spinner 付き）
- client side polling（3 秒間隔）で draft.status の変化を監視
- 完了 (pending_review or ai_failed) でリアルタイム更新 → draft フォームまたは失敗カードに切り替え
- バックグラウンド完了時に Web Push 通知も配信

#### 3.1.4 AI 抽出完了後の draft フォーム
- 現状の `/admin/mail-inbox/[id]` と同じレイアウト・フィールド
- 抽出結果の編集 + 承認 / 却下
- 承認 → events INSERT → LINE 配信（broadcastMailToEvent）
- N 件分割（tournament-title-grade-split）ロジックそのまま流用

#### 3.1.5 AI 抽出失敗時
- draft.status='ai_failed' で表示
- 「再試行」「手動でイベント作成」の 2 ボタン
- **再試行**: 再度 manual_extract ジョブを enqueue
- **手動でイベント作成**: 空の EventForm を mail 詳細画面に展開 → 入力 → events INSERT
  - 完了時に draft.status='approved' で締めて mail.status='archived' + triage_status='processed'

#### 3.1.6 既存イベント結びつけ UI
- モーダル or ボトムシート
- デフォルト表示: 未開催全て + 過去 30 日以内の events を受信日降順でリスト
- 検索ボックスで大会名フィルタ
- 選択 → 「結びつける」ボタン → 紐付け確定
- 確定後: linked_event_id 更新、broadcastMailToEvent を起動、triage_status='processed' に倒す
- 「訂正版」「補足情報」を区別せず、同じフローで処理

#### 3.1.7 events 詳細画面の「関連メール」セクション
- events 詳細ページ（/events/[id]）に新セクション「関連メール」を追加
- 紐付いた mail を受信日降順で一覧表示
- タイトル: 件名 / 送信者 / 受信日
- クリック → mail 詳細画面に遷移
- 3 経路を UNION で拾う：
  - (A) `linked_event_id = :eventId`（既存イベント結びつけ経由）
  - (B) `tournament_drafts.event_id = :eventId`（訂正版 draft → 既存イベント、linkDraftToEvent 経由）
  - (C) `events.tournament_draft_id` 経由（AI 抽出 → 承認で生まれた event）

#### 3.1.8 undo 機能（処理済→未処理に戻す）
- 処理済セクションでメール詳細を開く
- 「未処理に戻す」ボタンを表示
- 押下で triage_status='unprocessed' に戻す
- AI 抽出済み draft は残す（再度開けば編集可）
- 既存イベント結びつけは linked_event_id を NULL にする（LINE 配信済みメッセージは取り消せないので「紐付けだけ外す」）

### 3.2 ビジネスルール

#### 3.2.1 triage_status の遷移
- `unprocessed`（デフォルト）↔ `processed`
- 「保留 (deferred)」状態は廃止
- 既存の deferred 状態のメールは migration で unprocessed に移行

#### 3.2.2 処理アクションと triage_status の関係
- AI 抽出ボタン押下時点では `unprocessed` のまま（draft 作成 + status=ai_processing）
- draft 承認 / 却下 / 対応不要 / 既存イベント結びつけのいずれかで `processed` に倒す
- undo で `unprocessed` に戻せる

#### 3.2.3 pre-filter（メルマガ自動判定）
- コード保持。`classification='noise'` 付与は維持
- inbox UI のフィルタは外す（全件表示）
- 将来「ノイズタブ」を追加できる余地を残す

#### 3.2.4 自動 AI 分類・抽出の廃止
- mail-worker の cron からは llmExtractor を渡さない運用に変更
- pipeline.ts の AI phase コードは保持（manual_extract ジョブから再利用）
- 既存 pending_review な draft はそのまま残置、既存の承認/却下フローで処理

#### 3.2.5 AI 抽出コスト管理
- 確認ダイアログで誤タップ防止
- 再試行は明示的なボタン押下のみ
- バックグラウンドジョブとしてキューイング、cron からは呼ばれない

#### 3.2.6 既存イベント結びつけのビジネスルール
- 1 メールに対して 1 イベントのみ紐付け可能（FK 設計）
- 紐付け済みメールを別イベントに紐付け直す場合は、一度 undo してから再操作
- 同じイベントに複数メールが紐付くのは OK

## 4. 技術設計

### 4.1 API 設計（Server Actions）

| Action | 状態 | 内容 |
|---|---|---|
| `triggerExtractDraft(mailId)` | **新規** | `tournament_drafts` INSERT (status='ai_processing', payload='{}'::jsonb, prompt_version='', ai_model='') + `mail_worker_jobs` INSERT (kind='manual_extract', payload={mail_message_id: mailId}) |
| `linkMailToEvent(mailId, eventId)` | **新規** | `linked_event_id`, `triage_status='processed'`, `triaged_at`, `triaged_by_user_id` 更新 + after() で `broadcastMailToEvent` |
| `unlinkMailFromEvent(mailId)` | **新規** | `linked_event_id=NULL` + `triage_status='unprocessed'` 戻し（LINE 配信済みメッセージは取り消し不可） |
| `triggerMailFetch(sinceDate)` | 既存維持 | `kind='fetch'` を明示 |
| `approveDraft(draftId, formData)` | 既存維持 | そのまま流用 |
| `rejectDraft(draftId, reason)` | 既存維持 | そのまま流用 |
| `dismissMail(mailId)` | 既存維持 | `triage_status='processed'` |
| `undoTriage(mailId)` | 既存維持 | `deferred` 経路は migration で削除 |

### 4.2 DB 設計

#### 4.2.1 mail_messages テーブル
追加カラム:
```sql
ALTER TABLE mail_messages
  ADD COLUMN linked_event_id integer
    REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX mail_messages_linked_event_id_idx
  ON mail_messages (linked_event_id)
  WHERE linked_event_id IS NOT NULL;
```

#### 4.2.2 tournament_drafts.status enum 拡張
新規 enum 値: `'ai_processing'`
- 状態遷移: `ai_processing` → `pending_review`（成功）/ `ai_failed`（失敗）
- 既存値: `pending_review` / `approved` / `rejected` / `ai_failed` / `superseded`

#### 4.2.3 mail_triage_status enum 縮小
削除 enum 値: `'deferred'`
- migration: `UPDATE mail_messages SET triage_status='unprocessed' WHERE triage_status='deferred'`
- enum 値削除は再作成方式（一時 enum 経由）

#### 4.2.4 mail_worker_jobs テーブル変更
追加カラム:
```sql
CREATE TYPE mail_worker_job_kind AS ENUM ('fetch', 'manual_extract');

ALTER TABLE mail_worker_jobs
  ADD COLUMN kind mail_worker_job_kind NOT NULL DEFAULT 'fetch',
  ADD COLUMN payload jsonb;
```
- `payload` 構造: `{ mail_message_id?: number }`（manual_extract 時のみ必須）

#### 4.2.5 migration ファイル
- `packages/shared/drizzle/0022_mail_inbox_mailer.sql` (drizzle-kit generate)
- 内容:
  1. mail_worker_job_kind enum 作成
  2. mail_worker_jobs.kind, payload 追加
  3. mail_messages.linked_event_id 追加 + index
  4. tournament_drafts.status enum 拡張（'ai_processing' 追加）
  5. UPDATE mail_messages SET triage_status='unprocessed' WHERE triage_status='deferred'
  6. mail_triage_status enum 再作成（deferred を削除）

### 4.3 フロントエンド設計

#### 4.3.1 既存コンポーネント変更
- `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`
  - クエリの noise フィルタ削除（全件表示）
  - triage_status `deferred` フィルタ削除
- `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx`
  - 本文を即表示（トグル廃止）
  - draft 状態に応じた表示分岐:
    - draft なし: アクション 3 ボタン表示
    - draft.status='ai_processing': ExtractionInProgressCard
    - draft.status='pending_review': 既存 DraftCard + EventApprovalForm
    - draft.status='ai_failed': 再試行ボタン + 「手動でイベント作成」ボタン
- `apps/web/src/app/(app)/events/[id]/page.tsx`
  - 「関連メール」セクション追加

#### 4.3.2 新規コンポーネント
- `components/AIExtractConfirmDialog.tsx`: 「AI で抽出します、よろしいですか？」
- `components/ExtractionInProgressCard.tsx`: spinner + ステータステキスト + polling
- `components/ExistingEventLinkSheet.tsx`: 既存イベント選択ボトムシート（直近 30 日 + 検索）
- `components/MailDetailActions.tsx`: 3 ボタンエリア
- `components/UndoTriageButton.tsx`: 処理済画面用の戻すボタン
- `components/EventRelatedMails.tsx`: events 詳細の「関連メール」セクション

#### 4.3.3 状態管理
- AI 抽出中のリアルタイム更新: client side polling（3 秒間隔）
  - `/api/admin/mail-inbox/[id]/draft-status` で draft.status を返す
  - status が `pending_review` / `ai_failed` に変わったら `router.refresh()` でサーバー側 RSC を再取得

### 4.4 バックエンド設計

#### 4.4.1 mail-worker (apps/mail-worker)
- `src/pipeline.ts`:
  - cron 動作（kind='fetch'）では `llmExtractor` を渡さない運用に変更（CLI 引数で制御）
  - AI phase コード自体は残置、manual_extract から再利用
- `src/jobs.ts`:
  - dispatcher に kind 分岐追加
    - 'fetch': 既存の runOnce 呼び出し
    - 'manual_extract': payload.mail_message_id から mail を取得 → classifyMail + persistOutcome を呼び出し
- `src/index.ts`:
  - CLI に `--mode=extract-only` フラグ追加
  - extract-only モードは IMAP fetch を skip して manual_extract ジョブだけ処理

#### 4.4.2 systemd timer
- 新規: `kagetra-mail-worker-extract.timer`（30 秒間隔、`--mode=extract-only`）
- 既存: `kagetra-mail-worker.timer`（30 分間隔、fetch のみ、AI 抽出は呼ばない運用に変更）

#### 4.4.3 LINE 配信
- 既存 `broadcastMailToEvent` をそのまま再利用（変更なし）
- 既存 `mail-body-as-image` をそのまま再利用（変更なし）
- 既存 `event_broadcast_messages` テーブルもそのまま

#### 4.4.4 API Routes
- 新規 `apps/web/src/app/api/admin/mail-inbox/[id]/draft-status/route.ts`
  - GET: `tournament_drafts.status` を返す軽量エンドポイント（polling 用）
- 既存ルートは変更なし

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル
- `apps/mail-worker/src/pipeline.ts`: AI phase を opts.llmExtractor で制御
- `apps/mail-worker/src/jobs.ts`: dispatcher の kind 分岐
- `apps/mail-worker/src/index.ts`: --mode=extract-only 追加
- `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`: フィルタ条件変更
- `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx`: 詳細画面の再構成
- `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`: Server Actions 追加・修正
- `apps/web/src/app/(app)/events/[id]/page.tsx`: 関連メールセクション追加
- `packages/shared/src/schema/mail-messages.ts`: linked_event_id 追加
- `packages/shared/src/schema/tournament-drafts.ts`: status enum 拡張
- `packages/shared/src/schema/mail-worker.ts`: kind, payload 追加
- `packages/shared/src/schema/enums.ts`: enum 定義変更
- `packages/shared/drizzle/0022_mail_inbox_mailer.sql`: 新規 migration
- `infra/systemd/kagetra-mail-worker-extract.timer`: 新規 systemd unit ファイル

### 5.2 既存機能への影響
- 既存 pending_review draft: 影響なし、現状の承認/却下フローで処理可能
- 既存 events に紐付いた draft: 影響なし
- 既存 LINE 配信 (broadcastMailToEvent): 影響なし
- 既存 mail-body-as-image: 影響なし
- 既存 event-lifecycle-notify / entry-notify-lottery-treasurer: events 経由なので影響なし
- 既存 Web Push (mail-triage-badge): 影響なし、新規メール通知はそのまま動く
- pre-filter: コード保持、UI フィルタを外すだけ

### 5.3 共通コンポーネント・ユーティリティへの影響
- EventForm: 影響なし、再利用
- mail-worker の classifyMail/persistOutcome: 影響なし、再利用
- broadcastMailToEvent: 影響なし、再利用

### 5.4 API・DBスキーマの互換性
- 後方互換性: 既存データはそのまま使える
- 破壊的変更:
  - `mail_triage_status` enum から 'deferred' 削除（migration で全件 unprocessed に倒すので実害なし）
- 新規カラムは NOT NULL DEFAULT 付与で既存行に impact なし

### 5.5 テスト影響
- `apps/mail-worker/test/pipeline.test.ts`: cron 動作変更分のテスト修正
- `apps/mail-worker/test/jobs.test.ts`: dispatcher kind 分岐の新テスト追加
- `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts`: 新規 Server Action のテスト追加
- 新規 E2E: AI 抽出→承認→LINE 配信の通しテスト
- 新規 E2E: 既存イベント結びつけ→LINE 配信の通しテスト

## 6. 設計判断の根拠

### 6.1 ノイズ自動判定の廃止
- メール抜け漏れリスクを最小化するため、AI 自動分類は廃止
- ただし pre-filter のコード（ヘッダベースのメルマガ判定）は **残す**。inbox UI 側の「ノイズ非表示」フィルタを外すだけで全件見える状態にする
- 将来「ノイズタブ」を作りたくなった時のためにフラグを残す

### 6.2 AI 抽出のバックグラウンド化
- Sonnet 4.6 で本文＋添付込みの抽出は 5〜30 秒。同期で待たせると UX 悪い
- 「会で流す（AI 抽出）」ボタン押下 → 即座に draft 行 INSERT (status=ai_processing) → 画面遷移 → バックグラウンド完了後に Web Push で通知

### 6.3 draft テーブルは残す
- N 件分割（1 メール = 複数大会）、再抽出、承認 race 直列化、LINE 配信トリガー、訂正版管理の責務がある
- 違いは「自動 INSERT」から「ボタン押下時 INSERT」への変更だけ

### 6.4 triage_status の簡素化（3 状態 → 2 状態）
- `unprocessed`（未処理）/ `processed`（処理済み）の 2 状態
- 「保留」は廃止：処理せずに放置することが暗黙の保留である

### 6.5 既存データ移行方針
- 過去の `classification` カラムの値は残す（参照のみ）
- 将来的に `classification` カラム自体は削除する migration を予定
- 既存 deferred mails は unprocessed に倒す
- 既存 pending_review draft はそのまま、現状の承認/却下フローで処理

### 6.6 「訂正版」と「補足情報」を区別しない
- どちらも「既存イベント結びつけ」アクションで統一処理
- AI による is_correction 判定は廃止（手動判断に集約）
- イベント本体の情報変更（開催日/会場等）は管理者が events テーブルを edit する手動運用

### 6.7 既存イベント検索範囲（未開催 + 過去 30 日）
- 未開催: 補足情報の主な対象（組合せ表など）
- 過去 30 日: 領収書/事後連絡などの結びつけ用

### 6.8 mail_messages.linked_event_id 直 FK（中間テーブルにしない）
- 1 メール = 1 イベントのシンプル設計
- AI 抽出経路（tournament_drafts.event_id / events.tournament_draft_id）と別 carrier
- 将来 M:N が必要になれば中間テーブルに移行可能

### 6.9 mail_worker_jobs に kind 追加（新規テーブルにしない）
- 既存 dispatcher を流用できる
- 既存 status, claimed_at, run_id などの仕組みも流用
- 新規テーブルを作ると dispatcher/UI が二重化する

### 6.10 polling 方式（SSE / WebSocket にしない）
- SSE は Next.js App Router で動かすのに余計な設定が必要
- 3 秒間隔の軽量 GET なら十分。AI 抽出は 5〜30 秒、平均 6 回程度の polling で完了する
- 既存 fetch API と同じ仕組みで実装簡単

### 6.11 systemd timer を別建て（既存 timer に乗らない）
- 既存 30 分間隔 timer を変えると IMAP fetch 頻度も変わる
- AI 抽出だけ高頻度（30 秒間隔）にしたいので別 timer
- mail-worker 本体は 1 つのまま、CLI 引数で挙動を切り替える
