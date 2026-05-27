---
name: impl-event-line-broadcast-all
description: "event-line-broadcast 全 9 タスク (#55-#63) を 2026-05-26 に完了。worktree C:/tmp/impl-event-line-broadcast、ブランチ feature/event-line-broadcast-schema、9 コミット (b6a11cc..c47721d)、PR 作成・本番デプロイ未実施"
metadata: 
  node_type: memory
  type: project
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# event-line-broadcast 全 9 タスク完了

## 状態 (2026-05-26)
- ブランチ: `feature/event-line-broadcast-schema`
- Worktree: `C:/tmp/impl-event-line-broadcast`
- コミット: 9 件 `b6a11cc..c47721d`
- 親 Issue: [#54](https://github.com/poponta2020/kagetra_new/issues/54) — 全タスク完了マーク済み
- 子 Issue #55-#63 — マージ時に `Fixes #N` で自動クローズ

## 実装内容まとめ

### PR1 (b6a11cc): スキーマ #55
- enums: lineChannelPurposeEnum / eventLineBroadcastStatusEnum / eventBroadcastMessageStatusEnum
- line_channels: purpose + assignedEventId (UNIQUE + FK to events)
- 新規 3 テーブル: event_line_broadcasts (event_id UNIQUE + invite_code partial UNIQUE) / event_broadcast_messages (broadcast+mail UNIQUE) / attachment_share_tokens
- migration 0013_familiar_thunderbolt.sql

### PR2 (d5c4ee0): 招待コードユーティリティ #56
- apps/web/src/lib/invite-code.ts: generateInviteCode (crypto.randomInt), inviteCodeExpiresAt, verifyInviteCode (format → not_issued → expired → mismatch)
- 25 Vitest ケース

### PR3 (506cd0f): Bot プール管理 UI #57
- scripts/seed-broadcast-channels.ts: JSON から 30 Bot 投入
- /admin/line-channels/{page.tsx, [id]/page.tsx, actions.ts}: 一覧 + フィルタ + 詳細 + server actions (releaseChannel / disableChannel / enableChannel / manualLinkGroup)
- LineChannelTable, ManualLinkModal
- bottom-nav に Bot タブ追加

### PR4 (ef076b7): 招待コード UI #58
- events/[id]/actions.ts: generateInviteCodeForEvent, revokeBroadcast, extendBroadcastLifetime
- LineBroadcastSection (Client), InviteCodeModal (Client, 30分カウントダウン), BroadcastHistoryTable (Server)
- events/[id]/page.tsx に追加

### PR5 (29239d1): 添付画像化 + 署名 URL #60
- lib/attachment-image-render.ts: pdftoppm + libreoffice (要件定義の pdfjs-dist + canvas から変更、運用シンプル化)
- lib/image-cache.ts: 24h TTL in-memory Map
- /api/line-broadcast/attachments/[token]: 60 日署名 URL の DL
- /api/line-broadcast/images/[token]: 短期画像配信

### PR6 (be512ff): LINE Webhook #59
- /api/webhook/line/route.ts: nodejs runtime
- lib/line-webhook-handler.ts: signature verify (HMAC-SHA256 + timingSafeEqual), destination 引き (botId / channelId 両対応), join → joined_waiting_code + reply、leave → revoked + プール返却、6 桁数字 message → linked or 「❌ 無効」
- 13 Vitest ケース

### PR7 (b62fbf7): 配信ロジック + approveDraft 連動 #61
- lib/text-splitter.ts: 5000 字段落 / 文末 / ハードカット (surrogate-safe) 分割。9 ケース
- lib/line-broadcast.ts: broadcastMailToEvent (本文分割 + 添付画像化 + LINE push API fetch + 5 件/batch + 1.5s sleep + event_broadcast_messages 状態遷移)。4 ケース
- approveDraft で Next.js 15 `after()` で fire-and-forget 配信
- manualBroadcast server action

### PR8 (49cec56): 日次 cron + systemd + デプロイ手順 #62
- scripts/release-expired-broadcasts.ts: events.event_date + 30 days < today で released 化
- scripts/cleanup-expired-tokens.ts: 60 日 TTL + 7 日グレース後 DELETE
- systemd/kagetra-broadcast-cleanup.{service,timer}: 04:00 JST daily
- docs/deploy/event-line-broadcast.md: 11 セクション (OS パッケージ → migration → LINE Bot 作成 → seed → systemd → 動作確認 → トラブル / ロールバック)

### PR9 (c47721d): E2E + 全タスク完了 #63
- e2e/event-line-broadcast.spec.ts: invite UI ハッピーパス + プール枯渇エラー
- e2e/admin-line-channels.spec.ts: 一覧 + フィルタ + 一般会員 /403 + 詳細

## 設計判断メモ (重要)
- 要件定義書の partial unique 条件 `WHERE invite_code IS NOT NULL AND invite_code_expires_at > now()` のうち `> now()` 部分は volatile で使えないため削除。アプリ層で期限切れ判定
- 要件定義書の `pdfjs-dist + canvas` を `pdftoppm (poppler-utils) + libreoffice` に変更。Node native module 不要、本番に apt install するだけ
- approveDraft の配信トリガーは `after()` で fire-and-forget、失敗は console.error のみ
- LINE SDK は使わず fetch で reply / push 直接叩く (apps/web に依存追加なし)
- bottom-nav に Bot タブ追加 (admin 表示で 6 タブ、要件定義通り)

## Why (なぜこの状態か)
mail-tournament-import の下流として「メール承認 → events 登録 → LINE 自動配信」のラストワンマイルを完成させた。9 commits 同一ブランチに積み、PR1 として総まとめでレビュー予定。

## How to apply (今後の参照点)
- PR 作成は `/prepare-pr feature/event-line-broadcast-schema` で行う
- 本番デプロイは [docs/deploy/event-line-broadcast.md](docs/deploy/event-line-broadcast.md) 通り (poppler-utils + libreoffice の OS インストール + LINE Developers での 30 Bot 作成 + seed + systemd)
- レビュー指摘修正は worktree C:/tmp/impl-event-line-broadcast で実施

## 関連
- 親 Issue: [#54](https://github.com/poponta2020/kagetra_new/issues/54)
- 要件定義書: docs/features/event-line-broadcast/requirements.md
- 実装手順書: docs/features/event-line-broadcast/implementation-plan.md
- [[project-event-line-broadcast]] — 要件定義段階のメモ
- [[feedback-windows-worktree-path]] — `/tmp` ではなく `C:/tmp/...` を明示
