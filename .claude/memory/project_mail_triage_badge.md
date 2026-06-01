---
name: project-mail-triage-badge
description: mail-triage-badge SHIPPED。PR #95 merge 2ca9af2 (2026-06-01) 本番反映 success、Issue #87-92 全クローズ。残DoD=本番VAPID鍵設定+iOS実機バッジ確認
metadata: 
  node_type: memory
  type: project
  originSessionId: e43fca66-7412-40b3-afb9-58f9d66e6a85
---

メール見落としゼロ化のための機能定義完了 (2026-06-01)。届いた全メール(ノイズ含む)に処理状態を持たせ、未処理件数を PWA アプリアイコンのバッジで表示する。

- 要件定義書: docs/features/mail-triage-badge/requirements.md (completed)
- 実装手順書: docs/features/mail-triage-badge/implementation-plan.md (completed)
- Issue: 親 #87、子 #88(DBスキーマ+migration) / #89(処理状態Actions+未処理数API) / #90(inbox UI再構成) / #91(Web Push基盤) / #92(mail-worker Push配信)

**確定した要件:**
- 対象: 管理者・副管理者。処理は基本管理者
- 通知: Web Push、1メール1通知(noise含む全件)
- 処理状態: triage_status enum (unprocessed/processed/deferred)。未処理バッジ = processed 以外(未処理+保留)
- 処理アクション4種: 大会取込/既存紐付け/対応不要片付け/保留。draft 有無に関わらず全メールで実行可
- 既存メールは migration で processed ベースライン化(バッジ0開始)
- バッジ同期は準リアルタイム(他端末の処理は次回フォアグラウンドで count API 同期。処理ごとの全管理者Pushは見送り)

**主要設計判断:**
- 処理状態(triage_status)を AI/技術状態(status)とは別カラムに。直交するため(ai_done でも未処理あり得る)。既存 status='archived' は温存
- iOS PWA Badging API は 16.4+ 対応、ホーム画面追加＋通知許可が前提。背景更新は SW の push イベント経由 web-push(VAPID) 必須
- 現状 PWA は manifest+icons のみ、Service Worker/Web Push はゼロから追加

**Why:** AI のノイズ判定の限界による重要メール見落としが怖い、という運用課題から。現状メール通知は大会ドラフト化時のみ LINE 通知で、ノイズ/非大会メールは無通知だった。

**How to apply:** /implement mail-triage-badge で実装着手。PR分割目安は A(タスク1+2)/B(タスク3)/C(タスク4)/D(タスク5)。[[impl_event_lifecycle_notify]] は PR #85 で merge 済(migration 0017 適用)。本機能の migration は 0018 から採番。今後の並行 PR と shared/enums.ts/relations.ts で競合し得る点に注意(マージ時リベース)。PWA土台は [[project_pwa_minimal]]、メール機能の現状は [[impl_mail_body_as_image]]。

## 実装進捗
- worktree: `C:/tmp/impl-mail-triage-badge`、ブランチ `feature/mail-triage-badge`（origin/main 起点）
- **タスク1 (#88) 完了・push 済** (commit `27d009b`): enums に mailTriageStatusEnum、mail_messages に triage_status/triaged_at/triaged_by_user_id + index、push_subscriptions 新規テーブル、relations 更新、migration 0018（既存行 processed ベースライン）。型チェック通過。統合テスト(CRUD)はタスク2へ、migration適用+全テストは CI で検証。
- **タスク2 (#89) 完了・push 済** (commit `87484a6`): dismissMail/deferMail/undoTriage 新規 + 既存3アクション(approve/reject/link)に triage_status=processed 連動、GET /api/admin/mail/unprocessed-count(triage_status != processed)。テスト 60 passed(actions 55 + route 5)、型チェック通過。
- **タスク3 (#90) 完了・push 済** (commit `8940062`): 一覧を triage 区分(未処理/保留/処理済み、未処理優先取得+処理済み折りたたみ)、TriageActions(client) クイックアクション、mail/[id] 詳細ページ新規。mail-inbox テスト 82 passed、型チェック通過。
- **タスク4 (#91) 完了・push 済** (commit `9471870`): public/sw.js(push→通知+setAppBadge)、ServiceWorkerRegister(SW登録+前景バッジ同期 count API→setAppBadge)、/settings/notifications 購読UI、savePushSubscription/deletePushSubscription(endpoint upsert)、middleware /sw.js 除外、VAPID env(.env.example/.production)。web テスト 89 passed、型チェック通過。**iOS 実機での通知許可+バッジ確認は DoD（後日）**。
- **タスク5 (#92) 完了・push 済** (commit `a1df834`): notify/web-push.ts(admin/vice_admin の購読へ配信、badge=未処理数、HTTP 410/404 で失効削除)、pipeline onMailInserted フック、config loadWebPushConfig、index 注入、web-push 依存。mail-worker テスト 53 passed、型チェック通過。
- **全5タスク完了 → PR #95 → auto-review-loop 3R(r1=処理後バッジ再同期 / r2=詳細パス再検証+unsubscribe順序 を修正、r3=runPipeline型エラーは Codex 誤検出と確定し却下) → CI green → ship。merge `2ca9af2` (2026-06-01)、本番 auto-deploy success(migration 0018 適用=既存メール processed 化)、Issue #87-92 全クローズ、ローカル/リモートブランチ+worktree 削除済。**
- **残 DoD: ①本番に VAPID 鍵生成・設定 (npx web-push generate-vapid-keys → NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT)。未設定でも triage UI は動き Web Push のみ無効。②iOS 実機でホーム画面 PWA→通知許可→新着でバッジ増加を目視。**
