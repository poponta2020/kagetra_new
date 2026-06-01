---
name: project-mail-triage-badge
description: mail-triage-badge 要件定義完了。全メールトリアージ＋PWA未処理バッジ(Web Push)。Issue
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

**How to apply:** /implement mail-triage-badge で実装着手。PR分割目安は A(タスク1+2)/B(タスク3)/C(タスク4)/D(タスク5)。並行ブランチ [[impl_event_lifecycle_notify]] と migration番号・shared/enums.ts/relations.ts で競合し得るので、migration番号は後ろ採番しマージ時リベース。PWA土台は [[project_pwa_minimal]]、メール機能の現状は [[impl_mail_body_as_image]]。
