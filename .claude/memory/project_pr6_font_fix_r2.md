---
name: PR#6 第2回レビュー対応（フォントウェイト圧縮）
description: PR #6 Phase UI-1 の round 2 で Noto JP ウェイトを絞った修正内容と判断
type: project
originSessionId: 2622b0c7-178d-4426-96b6-a30a38c51854
---
PR #6 (feat/ui-foundation-design-tokens) round 2 レビュー対応（commit de4e13e）:

- Noto Sans JP: `400/500/600/700` → `400/500/700`（600 削除）
  - 600 は signin の LINE ログインボタン (`font-semibold`) のみで使用。synthetic fallback で許容
- Noto Serif JP: `400/500/700` → `700` のみ + `preload: false`
  - display 用途のみ。signin first view は sans だけを使うため preload 不要
- primitives.jsx:266 の未使用 `const total` を削除（Nit）

**Why:** CJK フォントは 1 ウェイトあたりの配信量が大きく、ルート全体で効くため LCP/TTI 悪化要因。レビュアーの推奨例「本文 400/500、見出し 700」に合わせた。

**How to apply:** 今後 Phase UI-2 以降でフォントウェイトを追加したくなったら、実使用箇所を grep で確認してから追加すること。特に serif に別ウェイトを足す場合は preload: false を維持するか再考する。
