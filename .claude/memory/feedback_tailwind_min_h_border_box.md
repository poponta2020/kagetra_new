---
name: tailwind-min-h-includes-padding-border-box
description: "Tailwind の `min-h-[N]` + `p-*` 同時指定は border-box で padding が min-h に算入され、コンテンツ領域が padding 分だけ圧縮される"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

Tailwind は default `box-sizing: border-box`。`min-h-[52px]` は **外側ボックス**（border + padding + content）の最小値。`pb-[env(safe-area-inset-bottom)]` (~34px) を併用すると、52 − 34 = 18px しかコンテンツ領域が残らない。中の子要素が大きい場合（例: `<Link h-[52px]>`）overflow して見切れる。

**正解**: padding を min-h に足し込む。

```html
<!-- ✗ コンテンツ領域が 18px に圧縮 -->
<nav class="min-h-[52px] pb-[env(safe-area-inset-bottom)] ...">

<!-- ✓ コンテンツ領域が 52px 確保 -->
<nav class="min-h-[calc(52px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] ...">
```

**Why:** PR #67 (sticky-mobile-shell の 2 度目の事後修正) で実機 NG → 原因特定。jsdom はレイアウト計算しないので vitest 構造テストでは検知不能、Playwright + 実機 viewport でしか再現しない。class assertion でリグレッションガード ([[sticky-mobile-shell-spec]])。

**How to apply:**
- `min-h-*` / `min-w-*` と `p-*` / `pt-*` / `pb-*` / `px-*` を同じ要素に当てる場合、必ず `calc(... + padding値)` で合算する
- safe-area / dvh / vh 系の動的な値が padding に入る場合、min-h 側も同じ動的式で揃える
- 関連する罠: [[flex-overflow-needs-min-h-0]] (flex item の min-height: auto 罠と組み合わさるとさらに見えづらくなる)

参照: CSS spec `box-sizing: border-box` (https://drafts.csswg.org/css-sizing/#box-sizing)
