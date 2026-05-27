---
name: tailwind-arbitrary-needs-underscore-for-space
description: "Tailwind arbitrary value 内のスペースは `_` でエスケープしないと CSS 生成時にスペースが消えて invalid な値になる"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb28a9ba-379a-4a6a-b704-e7d79919d95d
---

Tailwind の arbitrary value (`min-h-[...]`, `bg-[...]`, etc) は **literal な空白を含めない仕様**。`calc(52px + env(...))` をそのまま書こうとすると、Tailwind は空白で class が切れたと解釈する。`_` を空白として扱う規約があり、最終 CSS では実空白に展開される。

```html
<!-- ✗ Tailwind が CSS 生成時にスペースを消す → `calc(52px+env(...))` → Safari は invalid 扱い -->
<nav class="min-h-[calc(52px+env(safe-area-inset-bottom))]">

<!-- ✗ Tailwind class parser がスペースで切れて壊れる -->
<nav class="min-h-[calc(52px + env(safe-area-inset-bottom))]">

<!-- ✓ `_` が CSS の空白に展開される → `calc(52px + env(...))` で有効 -->
<nav class="min-h-[calc(52px_+_env(safe-area-inset-bottom))]">
```

**Why:** PR #67 R1 で Codex が blocker 指摘。当初は `calc(52px+env(...))` で書いていたが、Safari は CSS calc() の演算子周辺に空白を要求する仕様で、生成 CSS が無効化されて `min-height` が未設定になる罠だった。class 名 assertion だけでは検知できず、実機テストで初めて見える。

**How to apply:**
- arbitrary value 内で空白が必要な箇所 (calc の演算子、複数値プロパティ、grid-template など) は必ず `_` を使う
- `min-h-[calc(...)]` / `w-[calc(...)]` / `grid-cols-[1fr_2fr]` などのパターンで都度確認
- Codex / 人レビューでは「Tailwind arbitrary value 内に `+` `-` `*` `/` があるか」をチェックポイントにする
- 関連: [[tailwind-min-h-includes-padding-border-box]] (この罠と組み合わさると border-box で content が圧縮されて見切れる)

参照: Tailwind docs [Arbitrary values - Handling whitespace](https://tailwindcss.com/docs/adding-custom-styles#handling-whitespace)
