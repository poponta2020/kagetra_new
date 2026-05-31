---
status: completed
---
# event-lifecycle-notify 実装手順書

## 実装タスク

### タスク1: スキーマ拡張とマイグレーション
- [x] 完了
- **概要:** 申込・支払状態を保持するカラムと、once-ever 通知ログを追加する。5 enum 追加、`events` に 5 カラム追加、`event_lifecycle_notifications` テーブル新規作成、relations/index 更新、単一 migration を生成。既存 `events` 行は default 適用（`entry_status='not_applied'` / `payment_status='unpaid'` / `payment_type=NULL`）。
- **変更対象ファイル:**
  - `packages/shared/src/schema/enums.ts` — `event_entry_status` / `event_payment_type` / `event_payment_status` / `event_lifecycle_notification_type` / `event_lifecycle_notification_status` を追加
  - `packages/shared/src/schema/events.ts` — `entry_status` / `entry_applied_at` / `payment_type` / `payment_status` / `payment_paid_at` を追加
  - `packages/shared/src/schema/event-lifecycle-notifications.ts` — 新規（`UNIQUE(event_id, type)` + INDEX(event_id)）
  - `packages/shared/src/schema/relations.ts` — events ↔ event_lifecycle_notifications のリレーション追加
  - `packages/shared/src/schema/index.ts` — re-export 追加
  - `packages/shared/drizzle/` — 生成された migration ファイル（journal ベース、`db:migrate` 用）
  - `packages/shared/__tests__/` — スキーマの最小スモークテスト（型・enum 値）
- **依存タスク:** なし
- **対応Issue:** #80

### タスク2: 通知ライブラリ（文面テンプレ + push ヘルパ）
- [x] 完了
- **概要:** 8 種の通知文面テンプレートと、紐付け済みグループへ単一 text を送る `pushTextToEventGroup` を実装。**line-broadcast.ts は触らず**、新規ファイル内に単一テキスト用の軽量 push を自前で持つ（並行作業 mail-body-as-image との衝突回避）。once-ever ログの INSERT・前提条件判定（linked / cancelled 除外 / 締切 NULL 除外 / payment_type 分岐）もここに集約。テストファースト（ユニット）。
- **変更対象ファイル:**
  - `apps/web/src/lib/event-lifecycle-notify.ts` — 新規。文面テンプレ（`{title}`/`{MM/DD}`/`{fee}` 差し込み・絵文字プレフィックス）、単一テキスト用の軽量 push ヘルパ（fetch + `LINE_NOTIFY_DRY_RUN` 対応）、`pushTextToEventGroup`、各通知の送信関数（前提条件チェック＋ログ claim＋送信＋成否記録）、JST 今日算出
  - ※ `apps/web/src/lib/line-broadcast.ts` は**触らない**（衝突回避。push 共通化は mail-body-as-image ship 後にリファクタ）
  - `apps/web/src/lib/__tests__/event-lifecycle-notify.test.ts` — 新規。文面生成・金額 NULL・JST 日付・前提条件判定・once-ever（重複 INSERT 抑止）
- **依存タスク:** タスク1（#80）
- **対応Issue:** #81

### タスク3: 進行管理 UI と完了通知（申込/支払トグル）
- [ ] 完了
- **概要:** `/events/[id]` に進行管理セクションを追加。申込状態・支払いタイプ・支払状態のトグルと、紐付けありの場合の確認モーダル。トグルの server action で状態更新＋完了通知（初回遷移のみ、`event_lifecycle_notifications` 経由で once-ever）。一般会員には参照バッジのみ。API テスト→実装→フロントテスト→実装→E2E の順。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `setEntryApplied` / `setPaymentType` / `setPaymentPaid` を追加（`requireAdminSession` → tx 内で状態更新＋ログ INSERT ON CONFLICT DO NOTHING → コミット後 fire-and-forget で push → revalidatePath）
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — `EventLifecycleSection` を組み込み
  - `apps/web/src/components/events/EventLifecycleSection.tsx` — 新規（トグル＋確認モーダル、admin/vice_admin のみ）
  - `apps/web/src/components/events/LifecycleStatusBadge.tsx` — 新規（参照表示、会員にも出す）
  - `apps/web/src/app/(app)/events/[id]/__tests__/` — server action のユニット/統合テスト（once-ever、未紐付け時は送らない）
  - `apps/web/e2e/` — トグル操作・確認モーダル・会員参照のみの E2E
- **依存タスク:** タスク1（#80）, タスク2（#81）
- **対応Issue:** #82

### タスク4: 日次リマインドバッチと systemd timer
- [ ] 完了
- **概要:** 締切/当日リマインド（申込締切・事前支払締切・現地払い当日持参の各 事前/当日、計 6 種別）を 00:00 JST に処理する日次スクリプトと systemd ユニットを追加。前提条件を満たす event のみ once-ever で送信。リードタイムは `EVENT_LIFECYCLE_REMINDER_LEAD_DAYS`（既定 3）。統合テストでは `LINE_NOTIFY_DRY_RUN=1`。
- **変更対象ファイル:**
  - `apps/web/scripts/send-lifecycle-reminders.ts` — 新規（JST 今日算出 → 条件抽出 → タスク2 の送信関数で送信）
  - `apps/web/systemd/kagetra-lifecycle-reminders.service` — 新規
  - `apps/web/systemd/kagetra-lifecycle-reminders.timer` — 新規（`OnCalendar=*-*-* 00:00:00`、TZ=Asia/Tokyo 前提）
  - `apps/web/scripts/__tests__/send-lifecycle-reminders.test.ts` — 新規（締切=今日/今日+3 抽出、cancelled 除外、payment_type 分岐、UNIQUE で二重送信なし、未紐付け除外）
  - `docs/deploy/event-lifecycle-notify.md` — 新規（migration → リビルド → timer 配置/enable → DRY_RUN 確認の手順）
- **依存タスク:** タスク1（#80）, タスク2（#81）
- **対応Issue:** #83

## 実装順序
1. タスク1: スキーマ拡張（依存なし）
2. タスク2: 通知ライブラリ（タスク1 に依存）
3. タスク3: 進行管理 UI と完了通知（タスク1・2 に依存）
4. タスク4: 日次リマインドバッチ（タスク1・2 に依存。タスク3 とは独立、順不同可）

## 備考
- 1 PR = 1 タスクを基本とする（計 4 PR 想定）。
- タスク3・4 はタスク2 完了後なら並行着手も可能だが、1 人開発のため逐次推奨。
- **並行作業 mail-body-as-image との衝突回避**: タスク2 は line-broadcast.ts を触らず自己完結。共有ファイル衝突ゼロで順序 1→2→3→4 を維持。push 共通化は両ブランチ ship 後の別リファクタ。
- 本番デプロイ（Oracle Cloud 東京へ timer を `systemctl enable`）は Phase 4 完了後の cutover とは独立に実施可能（new.hokudaicarta.com 稼働中環境への追加）。
