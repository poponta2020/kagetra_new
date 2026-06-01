---
status: completed
---
# mail-triage-badge 実装手順書

## 実装タスク

### タスク1: DB スキーマ + migration（処理状態 + Push 購読）
- [x] 完了
- **概要:** 全メールの処理状態カラムと Push 購読テーブルを追加し、既存メールを処理済みでベースライン化する。
- **変更対象ファイル:**
  - `packages/shared/src/schema/enums.ts` — `mailTriageStatusEnum`（unprocessed/processed/deferred）追加
  - `packages/shared/src/schema/mail-messages.ts` — `triage_status`(not null, default `unprocessed`), `triaged_at`, `triaged_by_user_id` 追加
  - `packages/shared/src/schema/push-subscriptions.ts` — 新規テーブル（`user_id`, `endpoint` unique, `p256dh`, `auth`, `user_agent`, `created_at`, `last_used_at`）
  - `packages/shared/src/schema/relations.ts` — push_subscriptions ↔ users、必要に応じ mail_messages.triaged_by リレーション
  - `packages/shared/src/schema/index.ts` — エクスポート追加
  - `packages/shared/drizzle/<NNNN>_*.sql` + `meta` — migration（**event-lifecycle-notify と番号衝突回避し後ろ採番**）。**既存全行 `UPDATE mail_messages SET triage_status='processed'`** を含める
- **依存タスク:** なし
- **対応Issue:** #88
- **完了条件:** 型チェック通過、migration がローカル DB に適用でき既存行が `processed` になる、push_subscriptions に CRUD できる。

### タスク2: 処理状態の Server Actions + 未処理数 API
- [x] 完了
- **概要:** 全メールに対する4処理アクションと、未処理件数を返す API を実装。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `dismissMail` / `deferMail` / `undoTriage` 新規。既存 `approveDraft` / `rejectDraft` / `linkDraftToEvent` に `triage_status='processed'` + `triaged_at` / `triaged_by` 更新を追加
  - `apps/web/src/app/api/admin/mail/unprocessed-count/route.ts` — 新規 GET（admin/vice_admin、`triage_status != 'processed'` の件数）
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` — 状態遷移ケース追加、API route テスト
- **依存タスク:** タスク1
- **対応Issue:** #89
- **完了条件:** 各アクションで triage_status が正しく遷移、count API が未処理＋保留を返す、権限ガード（member→403）。

### タスク3: mail-inbox UI 再構成（全メール処理導線）
- [x] 完了
- **概要:** mail id ベースの詳細ページを作り4アクションのボタンを設置。一覧を未処理/保留/処理済みで区分。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` — 未処理/保留/処理済みの区分表示（未処理を上部、既存 tier を未処理内の整理として活用）
  - `apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx` — 新規 mail 詳細（本文/添付/AI分類/draft 併記）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/*` — 処理アクションボタン群（draft 無しメールの「大会取込」は AI 再抽出 or 手動イベント作成へ誘導）
  - フロントテスト
- **依存タスク:** タスク2
- **対応Issue:** #90
- **完了条件:** 全メールが詳細を開け、4アクションが実行でき、一覧の区分が処理状態を反映する。

### タスク4: Web Push 基盤（VAPID + Service Worker + 購読 UI + 前景バッジ）
- [x] 完了
- **概要:** ブラウザ Web Push の購読・保存と、Service Worker でのバッジ更新（背景）＋前景バッジ同期を実装。
- **変更対象ファイル:**
  - `apps/web/public/sw.js` — 新規。`push`→`showNotification` + `setAppBadge`、`notificationclick`→`/admin/mail-inbox`
  - `apps/web/src/components/ServiceWorkerRegister.tsx`（クライアント）— SW 登録 + 起動/可視化時に count API → `setAppBadge`（経路②）、処理操作後の再取得（経路③）
  - `apps/web/src/middleware.ts` — matcher に `/sw.js` 除外を追加
  - `apps/web/src/app/settings/notifications/*` — 通知有効化/無効化 UI、feature detection（`'setAppBadge' in navigator` / Notification）
  - Server Action: `savePushSubscription` / `deletePushSubscription`
  - VAPID 公開鍵の配布経路（env → 公開 config）
  - `.env.example` / `.env.production.example` — `VAPID_*` 追加
  - テスト: 購読保存・解除、count→badge ロジック
- **依存タスク:** タスク1（push_subscriptions）, タスク2（count API）
- **対応Issue:** #91
- **完了条件:** PWA で通知許可→購読が DB 保存され、アプリ起動時/処理後にバッジが正しい未処理数になる（実機 iPhone 確認は DoD）。

### タスク5: mail-worker からの Push 配信
- [ ] 完了
- **概要:** 新着メール取り込み時に、管理者・副管理者の全購読へ Web Push を送る（1メール1通知＋未処理数バッジ）。
- **変更対象ファイル:**
  - `apps/mail-worker/src/notify/web-push.ts` — 新規。`web-push` で VAPID 送信、HTTP 410/404 の subscription 削除
  - `apps/mail-worker/src/pipeline.ts` — 新規 `inserted` メールごとに配信フック（既存 LINE 通知とは独立、best-effort）
  - `apps/mail-worker/src/config.ts` — VAPID env 読み込み
  - `apps/mail-worker/package.json` — `web-push` 依存追加
  - テスト: 配信ペイロード、失効クリーンアップ、複数購読、LINE 通知との両立、dry-run
- **依存タスク:** タスク1, タスク4
- **対応Issue:** #92
- **完了条件:** 新着1件につき対象ユーザーの全端末へ通知が飛び、バッジ数が未処理総数になる。失効購読が削除される。

## 実装順序
1. タスク1（依存なし）
2. タスク2（タスク1）
3. タスク3（タスク2）
4. タスク4（タスク1・2）
5. タスク5（タスク1・4）

## PR 分割の目安
1機能だが規模が大きいため、以下の単位で分けると「小さく出す」原則に沿う（最終判断は prepare-pr 時）:
- **PR-A**: タスク1＋2（DB ＋ 処理状態 API。UI なしでも基盤が整う）
- **PR-B**: タスク3（全メール処理 UI。Push 無しでも「全メールに目を通す」が成立）
- **PR-C**: タスク4（Web Push 基盤＋バッジ）
- **PR-D**: タスク5（mail-worker 配信。新着でバッジが増える完成形）
