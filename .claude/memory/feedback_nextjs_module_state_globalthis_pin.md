---
name: feedback-nextjs-module-state-globalthis-pin
description: Next.js の Route Handler / Server Action / Server Component を跨いで共有する module-level state は globalThis pin が必須。chunk splitting で別 instance になる
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b152b79-1b8a-45cc-97a9-7f694024a998
---

# Next.js の module-level state は globalThis pin が必須

Server Action / Route Handler / Server Component を跨いで共有したい module-level state（`new Map()` / `new Set()` / `let counter = 0` 等）は、**必ず `globalThis` に pin する**。素の module-level 変数は、Next.js webpack が同モジュールを複数 chunk に bundle した結果、**chunk ごとに別 instance** になりうる。

## Why

2026-06-07 [[impl_fix_image_cache_module_instance]] で実害。`apps/web/src/lib/image-cache.ts` は LINE への本文画像配信用 in-memory cache を `const cache = new Map<string, CacheEntry>()` で持っていた。

- 起点バグ: ユーザーがメールを既存大会に「結びつける」と、添付ファイルは LINE 通知されるが、本文画像メッセージは届くが**中身が空**
- 本番 SSH 調査: `event_broadcast_messages.status='sent' / sent_image_count=2`（broadcastMailToEvent は完走）、nginx access.log は `/api/line-broadcast/images/<token>` を**全て 404**、`/api/line-broadcast/attachments/<token>` は 200 OK
- 退行ポイント: broadcast id 1-7（05-31〜06-02）は image URL 200 OK、id 8（06-07）のみ 404。`image-cache.ts` / `line-broadcast.ts` / image route のコードは 06-02 以降無変更
- 引き金: 06-07 merge の PR #127（mail-inbox-mailer）で**新 Route Handler 2 本**（`api/admin/mail-inbox/[id]/draft-status`, `api/admin/mail/unprocessed-count`）と**新 Server Action 群**（`triggerExtractDraft`, `linkMailToEvent`, `unlinkMailFromEvent`）が追加され、Next.js webpack の chunk splitting が再評価されて `image-cache.ts` が Server Action 側 chunk と Route Handler 側 chunk で**別々に bundle**された → それぞれが独立した `Map` instance を持ち、Server Action の `setCachedImage` で書いた buffer が Route Handler の `getCachedImage` から見えず常に miss → 404

「動いていたから大丈夫」は通用しない。**新 route / 新 server action の追加で chunk splitting は変わる**。

## How to apply

Server boundary を跨いで共有する module-level state（cache、registry、カウンタ、Set/Map、let 変数など）は、**最初から globalThis pin パターンで書く**。

```ts
interface State {
  cache: Map<string, Entry>
  totalBytes: number
}
const state: State = (
  (globalThis as unknown as { __myAppState?: State }).__myAppState ??= {
    cache: new Map(),
    totalBytes: 0,
  }
)
// 以後 state.cache / state.totalBytes を経由
```

- key は他のライブラリと衝突しないユニーク名（`__kagetraXxxState` 等）
- `cache` と `totalBytes` のような関連 state は**まとめて 1 オブジェクト**で pin（ばらばらに pin すると一方が共有・他方が分離になり整合性が崩れる）
- TypeScript の cast は `as unknown as { __myAppState?: State }` パターンが安全（型を `any` に落とさない）
- `_resetForTests()` などのテストフックも `state.cache.clear()` 経由で書く

Server / Route / Action を跨がず **同一 component ツリー内だけ** なら React の context / use キャッシュで十分。globalThis pin は「Next.js の server runtime boundary を跨ぐ共有」専用と覚える。

## 関連

- [[impl_fix_image_cache_module_instance]] — 実害が起きた本ケースの記録
- [[feedback_nextjs_standalone_static_cp]] — standalone の罠
