---
status: completed
---

# event-line-broadcast 実装手順書

## 実装タスク

### タスク1: スキーマ拡張・マイグレーション
- [x] 完了
- **概要:** `line_channels` 拡張 + 新規 3 テーブル (`event_line_broadcasts`, `event_broadcast_messages`, `attachment_share_tokens`) + 新規 enum 3 個。単一マイグレーションで実装。
- **変更対象ファイル:**
  - `packages/shared/src/schema/enums.ts` — `lineChannelPurposeEnum`, `eventLineBroadcastStatusEnum`, `eventBroadcastMessageStatusEnum` 追加
  - `packages/shared/src/schema/line-channels.ts` — `purpose` 列 + `assigned_event_id` 列 + UNIQUE 追加
  - `packages/shared/src/schema/event-line-broadcasts.ts` — 新規
  - `packages/shared/src/schema/event-broadcast-messages.ts` — 新規
  - `packages/shared/src/schema/attachment-share-tokens.ts` — 新規
  - `packages/shared/src/schema/relations.ts` — 新規 relation 拡張
  - `packages/shared/src/schema/index.ts` — re-export 追加
  - `packages/shared/drizzle/0013_*.sql` — マイグレーション (`pnpm db:generate` で生成、既存 system 行の `purpose='system_notify'` を含める)
- **依存タスク:** なし
- **対応Issue:** #55

### タスク2: 招待コード生成ロジック + ユーティリティ
- [x] 完了
- **概要:** 6 桁数字コード生成・検証・期限管理。UNIQUE partial index と連携。
- **変更対象ファイル:**
  - `apps/web/src/lib/invite-code.ts` — 新規 (`generateInviteCode()`, `verifyInviteCode()`, `isExpired()` 等)
  - `apps/web/src/lib/invite-code.test.ts` — Vitest ユニットテスト
- **依存タスク:** タスク1 (#55)
- **対応Issue:** #56

### タスク3: Bot プール管理画面 + 初期投入スクリプト
- [x] 完了
- **概要:** 30 Bot の状態を一覧・操作する管理者画面、初期投入 CLI。
- **変更対象ファイル:**
  - `apps/web/scripts/seed-broadcast-channels.ts` — 新規 (JSON 受け取り → INSERT)
  - `apps/web/src/app/(app)/admin/line-channels/page.tsx` — 新規 (一覧)
  - `apps/web/src/app/(app)/admin/line-channels/[id]/page.tsx` — 新規 (詳細・手動紐付け)
  - `apps/web/src/app/(app)/admin/line-channels/actions.ts` — 新規 server actions (`releaseChannel`, `disableChannel`, `manualLinkGroup` 等)
  - `apps/web/src/components/admin/LineChannelTable.tsx` — 新規
  - `apps/web/src/components/admin/ManualLinkModal.tsx` — 新規
  - `apps/web/src/components/layout/` — admin ナビに「LINE 配信 Bot 管理」追加
  - `apps/web/src/middleware.ts` — `/admin/line-channels/*` の admin/vice_admin ガード追加
- **依存タスク:** タスク1 (#55)
- **対応Issue:** #57

### タスク4: 招待コード生成 UI + LineBroadcastSection
- [x] 完了
- **概要:** `/events/[id]` 詳細画面に「LINE 配信」セクションを追加、招待コード発行 UI を実装。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — 既存に `LineBroadcastSection` を追加
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `generateInviteCode`, `regenerateInviteCode`, `releaseChannel`, `extendBroadcastLifetime`, `revokeBroadcast` server actions
  - `apps/web/src/components/events/LineBroadcastSection.tsx` — 新規
  - `apps/web/src/components/events/InviteCodeModal.tsx` — 新規 (招待コード表示 + QR + Bot 友だち追加 URL)
  - `apps/web/src/components/events/BroadcastHistoryTable.tsx` — 新規 (配信履歴表示)
- **依存タスク:** タスク2 (#56)、タスク3 (#57)
- **対応Issue:** #58

### タスク5: LINE Webhook + Bot 対話 (join/leave/code 認識)
- [x] 完了
- **概要:** `/api/webhook/line` で LINE Messaging API からの webhook を受信し、Bot 招待・コード認識・kick 処理を実装。
- **変更対象ファイル:**
  - `apps/web/src/app/api/webhook/line/route.ts` — 新規 (POST handler、X-Line-Signature 検証、destination 別 routing)
  - `apps/web/src/lib/line-webhook-handler.ts` — 新規 (event types 別処理ロジック)
  - `apps/web/src/lib/line-webhook-handler.test.ts` — Vitest テスト (signature 検証、各 event type)
  - `apps/web/src/middleware.ts` — `/api/webhook/line` を CSRF 対象外に設定
- **依存タスク:** タスク2 (#56)、タスク4 (#58)
- **対応Issue:** #59

### タスク6: 画像化処理 + 署名 URL API
- [x] 完了
- **概要:** PDF/Word を画像化する処理、Excel 用 60 日署名 URL の発行 API を実装。libreoffice 導入。
- **変更対象ファイル:**
  - `apps/web/src/lib/attachment-image-render.ts` — 新規 (`renderPdfToJpegs`, `renderDocxToJpegs`, `getOrCreateShareToken`)
  - `apps/web/src/lib/attachment-image-render.test.ts` — Vitest テスト (fixture PDF/DOCX で枚数・サイズ検証)
  - `apps/web/src/app/api/line-broadcast/attachments/[token]/route.ts` — 新規 GET (60 日署名 URL DL)
  - `apps/web/src/app/api/line-broadcast/images/[token]/route.ts` — 新規 GET (24h メモリキャッシュ画像配信)
  - `apps/web/src/lib/image-cache.ts` — 新規 (in-memory cache wrapper)
  - `apps/web/package.json` — `pdfjs-dist`, `canvas` 追加
  - `docker/Dockerfile` (apps/web) — `libreoffice-core`, `libreoffice-writer`, `libreoffice-calc` インストール RUN 追加
- **依存タスク:** タスク1 (#55)
- **対応Issue:** #60

### タスク7: 配信ロジック本体 + approveDraft 連動
- [ ] 完了
- **概要:** 本文分割・添付画像化・LINE batch push を組み合わせた配信処理を実装し、mail-inbox 承認フローに自動配信トリガーを差し込む。
- **変更対象ファイル:**
  - `apps/web/src/lib/line-broadcast.ts` — 新規 (`broadcastMailToEvent()`, batch push、リトライ、エラー記録)
  - `apps/web/src/lib/line-broadcast.test.ts` — Vitest テスト (LINE SDK mock、本文分割、エラーパス)
  - `apps/web/src/lib/text-splitter.ts` — 新規 (5000 字単位の段落境界スプリッタ)
  - `apps/web/src/lib/text-splitter.test.ts` — Vitest テスト
  - `apps/web/src/app/(app)/admin/mail-inbox/[id]/actions.ts` — `approveDraft` に `broadcastMailToEvent` の非同期呼び出し追加
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `manualBroadcast` (手動再配信) server action 追加
- **依存タスク:** タスク5 (#59)、タスク6 (#60)
- **対応Issue:** #61

### タスク8: 日次バッチ + systemd + 本番デプロイ
- [ ] 完了
- **概要:** 大会終了 +30 日経過の自動解放、期限切れトークン削除を日次で実行。systemd timer 配置と本番手順整備。
- **変更対象ファイル:**
  - `apps/web/scripts/release-expired-broadcasts.ts` — 新規 (events.event_date + 30 < today で `released` 化)
  - `apps/web/scripts/cleanup-expired-tokens.ts` — 新規 (60 日 + 7 日グレース超過分削除)
  - `docker/systemd/kagetra-broadcast-cleanup.service` — 新規 (oneshot)
  - `docker/systemd/kagetra-broadcast-cleanup.timer` — 新規 (日次)
  - `docs/deploy/event-line-broadcast.md` — 新規 (デプロイ手順書: LINE Developers 30 Bot 作成 → seed → migration → systemd 配置)
  - `.github/workflows/ci.yml` — libreoffice インストール step 追加 (or テストモック化方針を明記)
- **依存タスク:** タスク7 (#61)
- **対応Issue:** #62

### タスク9: E2E テスト + 動作確認
- [ ] 完了
- **概要:** Playwright で招待コード生成 UI と Bot 管理画面のハッピーパスをカバー、`LINE_NOTIFY_DRY_RUN=1` で配信モック確認。スマホ実機で 1 大会の通しテスト。
- **変更対象ファイル:**
  - `apps/web/tests/e2e/event-line-broadcast.spec.ts` — 新規 (招待コード生成 → モーダル → 配信履歴表示)
  - `apps/web/tests/e2e/admin-line-channels.spec.ts` — 新規 (30 Bot 一覧 → フィルタ → 手動紐付け)
- **依存タスク:** タスク4 (#58)、タスク7 (#61)
- **対応Issue:** #63

## 実装順序
1. タスク1 (スキーマ拡張) — 依存なし、土台
2. タスク2 (招待コードユーティリティ) — タスク1 に依存
3. タスク3 (Bot プール管理 UI + seed) — タスク1 に依存、タスク2 と並行可能
4. タスク4 (招待コード UI) — タスク2 + タスク3
5. タスク6 (画像化 + 署名 URL) — タスク1。タスク5 と並行可能
6. タスク5 (Webhook) — タスク2 + タスク4
7. タスク7 (配信ロジック + approveDraft 連動) — タスク5 + タスク6
8. タスク8 (日次 cron + デプロイ) — タスク7
9. タスク9 (E2E + 本番確認) — タスク4 + タスク7

各タスクが 1 PR に対応 (要件定義書 §8.4 の PR 分割案と一致、ただし PR9 を E2E として追加)。
