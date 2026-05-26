---
name: project-event-line-broadcast
description: event-line-broadcast 機能の要件定義完了。承認済み大会案内メールを LINE グループ自動配信する mail-tournament-import の下流機能。AI 介在なし生メール配信、Bot プール 30 個方式。実装着手は /implement event-line-broadcast 待ち
metadata: 
  node_type: memory
  type: project
  originSessionId: 94a246c5-6fda-4218-ab29-dfd45dcd786f
---

# event-line-broadcast — 大会案内メールの LINE グループ自動配信

## 位置付け
- `mail-tournament-import` (P3-A 完了) の下流機能
- P2「大会運営」と P3「AI+メール」のクロスオーバー
- mail 承認 → events 登録の先で、参加者 LINE グループへの配信を自動化

## Why (なぜこの機能が必要か)
- 現状: 管理者が大会参加確定者の LINE グループに毎大会、運営からのメールを **手動転送**
- 訂正版・補足連絡が来るたびに転送オペが発生、見落としリスク
- mail-tournament-import の下流を自動化することで運用負荷を完全に消す

## How to apply (今後の実装・関連作業で参照する点)
- 実装着手: `/implement event-line-broadcast` 待ち (CLAUDE.md ルール 1: 計画承認後も明示指示まで実装しない)
- 親 Issue: #54、子 Issue: #55 (スキーマ) / #56 (招待コードユーティリティ) / #57 (Bot プール管理 UI) / #58 (招待コード UI) / #59 (Webhook) / #60 (画像化 + 署名 URL) / #61 (配信ロジック + approveDraft 連動) / #62 (日次 cron + デプロイ) / #63 (E2E)
- 実装順序: #55 → #56/#57 → #58 → #60/#59 → #61 → #62 → #63
- 関連: [[project-kagetra-new-design]] (技術選定の前提) / [[project-production-deploy]] (Lightsail インフラ) / [[feedback-main-push-authorized-for-ship]] (ship 後の memory 同期 push 自動)

## 主要設計判断 (確定済み)

### AI 介在なし / 生メール配信
- 配信内容: `mail_messages.body_text` をそのまま (5000 字超は段落境界で分割)
- 訂正版は先頭に「【訂正】」プレフィックス
- `tournament_drafts.extracted_payload` は events 登録用、配信には使わない
- 理由: AI コスト不要、ユーザー要望「生データで OK」、本文の方が情報量豊富

### Bot プール 30 個
- `line_channels.purpose='event_broadcast'` を 30 行、LINE Messaging API の無料枠 200 通/月 制限を回避
- 既存 `system` 通知 Bot (`pushSystemNotification`) は `purpose='system_notify'` で分離
- LINE Developers Console で 30 Bot を **手動作成** (一度きり、~2.5h 作業)
- 年 10 大会未満なので、30 日保持しても枯渇しない

### 招待コード方式 (6 桁数字 + 30 分 + 1 回限り)
- 管理者が `/events/[id]` で発行 → LINE グループで Bot を招待 → コードを発言 → Webhook が認識して紐付け
- フォールバック: `/admin/line-channels/[id]` で手動グループ ID 入力
- 1 大会 1 グループ縛り (`event_line_broadcasts.event_id` UNIQUE)

### 自動解放 (events.event_date + 30 日)
- 日次 systemd timer で expired 行を `released` 化 → `line_channels.status='available'` に戻す
- 30 日バッファで打ち上げ・反省連絡まで吸収

### 添付配信戦略
- **PDF**: pdfjs-dist で 150 DPI JPEG 化 (既存依存)
- **Word**: libreoffice --headless で PDF 化 → pdfjs-dist (Lightsail に libreoffice 追加、+200MB)
- **Excel**: 画像化せず `attachment_share_tokens` (60 日署名 URL) を Flex Message でダウンロードボタン
- **30 ページ超**: 画像化打ち切り、Web リンクにフォールバック

### 配信トリガー
- `mail-inbox` の `approveDraft` server action 内で、events 登録 commit 後に **非同期 best-effort** で配信
- 配信失敗は承認を巻き戻さない、`event_broadcast_messages.status='failed'` に記録
- 訂正版も自動配信 (`is_correction=true` フラグで先頭プレフィックス付与)
- 未紐付け状態で承認した場合は配信スキップ、バックフィルなし

### Webhook routing
- `POST /api/webhook/line` の 1 URL で 30 Bot 受け、`destination` フィールドで識別
- `X-Line-Signature` HMAC-SHA256 検証は destination 別 `channel_secret` で

### Bot 対話
- 招待コード (`/^\d{6}$/` パターン) 以外は完全無視・無応答
- `join` イベント時のみ「招待コードを発言してください」とガイダンス
- `leave` で `revoked` 化 + プールに返却

## 新規 DB スキーマ
- `line_channels` 拡張: `purpose` enum (`system_notify`/`event_broadcast`) + `assigned_event_id`
- `event_line_broadcasts` (1 大会 1 連携): event_id UNIQUE, status 5 状態, invite_code partial unique
- `event_broadcast_messages` (配信履歴): (event_line_broadcast_id, mail_message_id) UNIQUE
- `attachment_share_tokens` (60 日 DL URL): token, expires_at

## 範囲外 (将来検討)
- LINE Login ベースのグループメンバー認証
- メンバーからの Bot コマンド (`!出欠` 等)
- 配信内容のテンプレ編集 UI
- AI 整形配信モード (`message_format` enum で拡張可能)
- 配信時刻スケジューリング

## 要件定義書・実装手順書
- `docs/features/event-line-broadcast/requirements.md` (status: completed)
- `docs/features/event-line-broadcast/implementation-plan.md` (status: completed)
