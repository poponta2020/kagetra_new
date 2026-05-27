---
name: flex-overflow-needs-min-h-0
description: flex item に overflow-y-auto を当てるときは min-h-0 が必須。さもなくば子コンテンツが親を突き抜けて body スクロールに化ける
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

`flex-1 overflow-y-auto` だけだと「内部スクロール」にならない。flex item のデフォルトは `min-height: auto` で「子コンテンツより縮まない」ため、main がコンテンツ高さに押されて shell の高さ制約 (h-dvh など) を突き抜け、body スクロールが発生する。

**正解**: `flex-1 min-h-0 overflow-y-auto` の 3 点セットを必ず一緒に付ける。

**Why:** PR #66 (sticky-mobile-shell の事後修正) で実機 NG → 原因特定に時間。jsdom はレイアウト計算しないので vitest 構造テストでは検知不能、実機/Playwright headful でしか再現しない種類のバグ。class アサーションでリグレッションガードするのが現実解 ([[sticky-mobile-shell-spec]])。

**How to apply:**
- スクロール領域を持つ flex item の className には `min-h-0`（縦） or `min-w-0`（横）を必ず明示
- code review でも `flex-1` + `overflow-y-auto` の組み合わせを見たら `min-h-0` の有無をチェック
- 似た罠: `grid` レイアウトでも `min-height: 0` が必要なことがある
- 二重防御で `<body>` に `h-dvh overflow-hidden` を当てる方法もあるが、body スクロール許容前提の他ページ（auth/signin など）への副作用に注意

参照: MDN [min-height#values](https://developer.mozilla.org/en-US/docs/Web/CSS/min-height#values) の `auto` 項
