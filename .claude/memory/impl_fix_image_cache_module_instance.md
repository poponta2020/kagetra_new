---
name: impl-fix-image-cache-module-instance
description: PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 1b152b79-1b8a-45cc-97a9-7f694024a998
---

# image-cache module instance 分離 fix（PR #129、Issue #128）

mail-inbox-mailer PR #127 反映後に発生した「LINE 本文画像メッセージは届くが中身が空」退行の修正。`apps/web/src/lib/image-cache.ts` の Map / totalBytes を `globalThis.__kagetraImageCacheState` に pin した。

- **PR #129**: merge `57ceadc` (2026-06-07)
- **Issue #128**: 自動クローズ
- **影響**: link 経路だけでなく承認経路（approveDraft / approveDraftUnits / linkDraftToEvent）でも 06-07 以降は LINE 本文画像が空表示になっていたはず（ユーザーは link 経路で初めて気付いた）
- **残 DoD**: 本番反映後（auto-deploy）、mail-inbox で「既存大会への結びつけ」or「会で流す」を実行して本文画像が中身込みで届くこと + nginx ログで `/api/line-broadcast/images/<token>` が 200 OK で返ることを実機確認

## Why

[[feedback_nextjs_module_state_globalthis_pin]] に詳述。要点：

- Next.js webpack は同モジュールを複数 chunk に bundle することがある。Server Action 側 chunk と Route Handler 側 chunk で別々に bundle されると、それぞれの module スコープが独立し、`const cache = new Map()` のような module-level state は **chunk ごとに別 instance** になる
- `setCachedImage`（broadcastMailToEvent 内）と `getCachedImage`（/api/line-broadcast/images/[token]）が**別の Map** を見るため、cache miss → 404

引き金は PR #127 で新 Route Handler 2 本 + 新 Server Action 群を追加したこと。これで webpack の chunk splitting が再評価された。

## How to apply

- LINE 本文画像が将来また「メッセージは届くが中身が空」になったら、まず nginx access.log で `/api/line-broadcast/images/<token>` の status を確認。**404 ならまた module instance 分離が再発**している
- 新たに module-level state を Server Action / Route Handler 跨ぎで共有する関数を書くときは、最初から globalThis pin で書く（feedback memory の例コード参照）

## 観測の手がかり（再発時の調査メモ）

本番調査で確証した順序：

1. `event_broadcast_messages.status='sent'` + `sent_image_count>0` → broadcastMailToEvent 自体は完走
2. nginx access.log の `/api/line-broadcast/images/<token>` が 404 → image-cache miss を直接示す
3. `/api/line-broadcast/attachments/<token>` は 200 OK（添付は DB 経由なので cache 関係ない）
4. 過去の broadcast 履歴と日時で切り分け → どの deploy で退行したか判明
5. その deploy で新 Route Handler / Server Action が増えていれば chunk splitting 起因を疑う

## 関連

- [[feedback_nextjs_module_state_globalthis_pin]]
- [[impl_mail_body_as_image]]（本文画像配信の元実装、PR #84）
- [[project_mail_inbox_mailer]]（退行の引き金になった PR #127）
