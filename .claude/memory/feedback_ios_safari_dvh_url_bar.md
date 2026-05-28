---
name: ios-safari-100dvh-includes-url-bar
description: "iOS Safari (15.4+) で viewport-fit=cover の場合 `100dvh` が下部 URL バー overlay 込みの高さを返し、shell が viewport を超える。`100svh` を最終勝ちにする"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

iOS Safari (iOS 15.4+) の `100dvh` 実装には罠がある: `viewport-fit=cover` を有効にすると、`100dvh` が **画面下の URL バー overlay を含んだ高さ** を返すことがある。結果、`h-dvh` を当てた shell が「見えている viewport」より大きくなり、最下段の要素（BottomNav など）が URL バーの裏側に隠れる。

**正解**: cascade を **CSS で固定** する（Tailwind utility ではダメ）。

```css
/* globals.css に専用クラスを定義 — 単一ルール内で順に declare すると
   ブラウザの cascade が「ブラウザが理解できる最後の declaration」を採用する */
.mobile-shell-h {
  height: 100vh;   /* fallback */
  height: 100dvh;  /* mid */
  height: 100svh;  /* 最終勝ち */
}
```

```html
<!-- ✗ Tailwind は utility 出力順を className 順では制御しない、勝者不定 -->
<div class="flex h-screen h-dvh h-svh flex-col">

<!-- ✓ CSS 側で cascade 固定 -->
<div class="mobile-shell-h flex flex-col">
```

cascade 意図:
- `100vh`   — 古いブラウザ fallback
- `100dvh`  — 中間（dynamic viewport が信頼できるブラウザ向け、ただし iOS Safari の URL バー罠あり）
- `100svh`  — 最終（small viewport、UA chrome 全表示時の最小高さ、URL バーの上に確実に収まる）

**Why:** PR #64/#66/#67 で `h-dvh` ベースの sticky shell を組み、3 度の修正でも実機で BottomNav が画面下端で見切れる現象が止まらず、PR #68 で `100svh` cascade を追加してようやく解消。viewport meta / 配信 CSS は全部正しく出力されていたため、原因特定までに数サイクル要した（[[sticky-mobile-shell-spec]]）。**PR #68 R1 で「Tailwind utility (`h-screen h-dvh h-svh`) では出力順が制御できない」と Codex が blocker 指摘 → globals.css の専用クラスに切り出し**。

**How to apply:**
- sticky bottom 系 UI (BottomNav / footer / FAB) で viewport 高さを取る場合、必ず `100vh` → `100dvh` → `100svh` の cascade を **同一 CSS ルール内で順に declare** する
- Tailwind の `h-screen h-dvh h-svh` のような utility 組み合わせはダメ（同一 property の utility は Tailwind 内部の sort で出力順が決まり className 順を反映しない、Codex blocker 経験あり [[tailwind-utility-output-order-not-className]]）
- 副作用: URL バー collapse 時に shell の下に空き帯ができる（dvh より svh の方が小さいため）。これは UX 上許容範囲、見た目を取るなら別途 visualViewport API でカスタム制御
- 類似罠: `100vh` も同じ問題、iOS Safari (< 15.4) では `100vh` = URL バー collapse 時の最大高さで常にオーバーフロー → `svh/dvh/lvh` の選択は always-conservative を推奨
- テスト: 専用 class (`.mobile-shell-h` 等) の存在確認 + Tailwind utility が混入していないことの negative assert を組み合わせる

参照: W3C [CSS Values 4 - Dynamic viewport-percentage units](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)、Tailwind v3.4+ で `h-svh`/`h-dvh`/`h-lvh` ユーティリティ追加（ただし上記の通り cascade 用途では使えない）。
