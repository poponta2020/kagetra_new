---
name: impl-event-line-broadcast-task1
description: "event-line-broadcast タスク1 (スキーマ拡張) を 2026-05-26 に完了。worktree C:/tmp/impl-event-line-broadcast、ブランチ feature/event-line-broadcast-schema、コミット b6a11cc、#55 close 予定 (merge 時)"
metadata: 
  node_type: memory
  type: project
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# event-line-broadcast タスク1 (スキーマ拡張) 完了

## 状態 (2026-05-26)
- ブランチ: `feature/event-line-broadcast-schema`
- Worktree: `C:/tmp/impl-event-line-broadcast`
- コミット: `b6a11cc` (push 済み)
- Issue: #55 ([feat-line-broadcast PR1] スキーマ拡張・マイグレーション) — merge 時に自動 close

## 実装内容
- enums.ts: `lineChannelPurposeEnum`, `eventLineBroadcastStatusEnum`, `eventBroadcastMessageStatusEnum` の 3 つを追加
- line-channels.ts: `purpose` 列 (default 'system_notify') と `assignedEventId` (UNIQUE + FK to events ON DELETE SET NULL) を追加
- event-line-broadcasts.ts: 新規 (1 大会 1 連携, event_id UNIQUE, invite_code partial UNIQUE)
- event-broadcast-messages.ts: 新規 (配信履歴, broadcast_id+mail_id UNIQUE)
- attachment-share-tokens.ts: 新規 (60 日署名 URL, expires_at index)
- relations.ts: 4 テーブル分 + 既存テーブルへの双方向参照を追加
- migration: `0013_familiar_thunderbolt.sql` を `pnpm db:generate` で生成、test DB へ drizzle-kit push で適用検証

**Why:** mail-tournament-import の下流として、LINE グループへの自動配信機能の土台を作るため。Bot プール 30 個 + 招待コード方式 + 1 大会 1 連携 + 30 日自動解放の物理スキーマを確定させる。

**How to apply:** 後続タスク (#56-#63) は本ブランチ (feature/event-line-broadcast-schema) を基底に積む。次は #56 (招待コードユーティリティ) と #57 (Bot プール管理 UI) が並行着手可能。

## 設計判断メモ
- 要件定義書の partial unique 条件 `WHERE invite_code IS NOT NULL AND invite_code_expires_at > now()` のうち `> now()` 部分は PostgreSQL の制約 (partial index 述語は IMMUTABLE 要求) で使えないため削除。`WHERE invite_code IS NOT NULL` のみ。期限切れ判定はアプリ層 (`invite-code.ts` の verifyInviteCode) で行う前提
- 既存 `line_channels.status='system'` 行は `purpose` カラムの DEFAULT 'system_notify' で自動マッピング → 追加の UPDATE 文不要
- `line_channels.assigned_event_id` UNIQUE は NULL 重複を許容するので、`available` プール 30 行は制約に縛られない (既存 `assigned_user_id` と同パターン)
- `mail_message_id` ON DELETE RESTRICT: 配信履歴は mail_messages 削除より長持ちさせる
- `event_id` ON DELETE CASCADE: event 削除時は連携情報も消える方が自然

## 関連
- 親 Issue: [#54](https://github.com/poponta2020/kagetra_new/issues/54) — タスク #55 を完了マークに更新済み
- [[project-event-line-broadcast]] — 要件定義書の主要設計判断
- [[feedback-windows-worktree-path]] — worktree は `C:/tmp/...` で明示作成 (今回も適用)
