---
name: tailwind-utility-output-order-not-classname
description: Tailwind の utility CSS 出力順は className の記述順では制御できない。同一プロパティを複数 utility で重ねて cascade を期待してはいけない
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

Tailwind の utility はビルド時に内部 sort（CSS property の優先度や utility のレイヤー）で並び替えられて出力される。**className に書いた順では出力されない**。同じ CSS property を複数 utility で重ねて「最後のものが勝つ」cascade を狙うと、生成 CSS で順序が逆転して**最後勝ち想定が崩れる**ことがある。

```html
<!-- ✗ 「h-svh が勝つ」想定だが、Tailwind 出力では h-svh → h-dvh の順になる
     こともあり、結果として 100dvh が勝つ -->
<div class="h-screen h-dvh h-svh">

<!-- ✓ 同一ルール内の CSS declaration で cascade 順を確定 -->
<style>
.mobile-shell-h {
  height: 100vh;
  height: 100dvh;
  height: 100svh;
}
</style>
<div class="mobile-shell-h">
```

**Why:** PR #68 R1 で Codex が blocker 指摘。`h-screen h-dvh h-svh` で `100svh` 最終勝ちを狙ったが、Tailwind のビルド出力順は className 順に従わないので「実機で h-dvh が勝って BottomNav が URL バー裏に隠れたまま」のリグレッションを残しうる。globals.css に専用クラスを切り出して CSS 側で cascade を固定する形に変更。

**How to apply:**
- 同一 property を複数 utility で重ねる ≠ cascade 制御。これを根本的に避ける
- viewport 単位 (`vh`/`dvh`/`svh`/`lvh`) や `position` のような複数値 fallback パターンは **globals.css に専用クラスを切る** のが正解
- Tailwind の arbitrary value (`h-[100svh]`) で単一指定は OK（cascade なし、対応ブラウザのみ機能）
- テスト: 専用 class 名の存在確認 + 同一 property の Tailwind utility が混入していないことを negative assert (`.not.toMatch(/\bh-screen\b/)` 等) でガード
- 関連: [[ios-safari-100dvh-includes-url-bar]] (これが発覚したオリジナル罠)

参照: Tailwind docs [Layer ordering](https://tailwindcss.com/docs/adding-custom-styles#using-css-and-layer) — 同一 layer 内の utility は内部 sort で並ぶ
