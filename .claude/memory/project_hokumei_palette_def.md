---
name: feature-def-hokumei-palette
description: 北溟配色の design-spec。round 4 で地と枠線の彩度を 0.375 倍へ（明度は据え置き）。不採用案と注意点を記録
type: project
---

# 北溟配色（白波 × 紺）design-spec — round 4 で地の青みを落とす

**正典**: `docs/features/hokumei-palette/design-spec.md`（`status: locked`・`round: 4`）
**検証スクリプト**: `docs/features/hokumei-palette/palette-check.mjs`（依存なし。exit 0 が合格。`LADDER_CHROMA` でラダーの彩度倍率を持つ）
**状態**: round 1〜3 は PR #648 で出荷済み（2026-09-21）。**round 4 は design-spec 確定・実装未着手（2026-09-22）**。次 = `/implement hokumei-palette`（Issue なし＝UI リデザインの前例どおり）

## round 4（2026-09-22）: 地の青みを落とす

- 発端: 本番の実画面を見たユーザーが「背景まで水色は少しやりすぎ」と判断した。A1 の残DoD「地の水色の強さ」が**強すぎる側**に振れた
- **明度は据え置き、彩度だけを落とした**。面と枠線のラダー 5 トークンの OKLCH 彩度を一律 0.375 倍にした（canvas 0.033 → 0.012）。明度を上げると純白カードとの ΔL が縮み、round 1 の「のぺっと」が再発するため
- 新値: canvas `#dfe8ed`・surface-alt `#d1dbe2`・border-soft `#cad2d9`・border `#b6bfc7`・border-strong `#9099a2`。ΔL は 0.074 / 0.040（下限 0.07 / 0.035 を維持）。コントラストは全ペアで実質不変
- 候補は彩度 0.020 / 0.016 / 0.012 の 3 案を同じ画面モックで並べた。ユーザーは最初「ほんのり水色を残す」を選び、比較のうえで最も淡い 0.012（案3）を選んだ。**寂しすぎた場合の調整先は案2 `#dde8f0`（倍率 0.5）。どちらへ動かしても明度は動かさない**
- 触らないもの: brand 系・ピル地・墨・朱・山吹・影・テクスチャ・LINE Flex・級トーン。ユーザーは「背景以外は特になし」と回答した
- 副作用（受容）: `neutral-bg`・`info-bg` と `surface-alt` がほぼ同色になる（1.03:1・OKLab 色差 0.011）。メール取込の下書きカード（`DraftCard` の surface-alt 箱の中の info/neutral ピル）と `admin/members` の種別バッジで見える。藤 × 墨の頃も同じかそれ以上に同色で、A1 で分かれていたのは副次効果だったので直さない
- 失効した記述: 「canvas 彩度 0.033 を下回ると水色と読めない」と、A2 `#c6e8fc` を調整先とする記述
- 実装の注意: 改訂 3 ファイルは main で**未コミットの変更**。`/implement` の worktree に cp して最初にコミットする。変わるのは globals.css の 10 行・`globals-tokens.test.ts` の spec 値・`layout.tsx` の themeColor・docs/design の 3 ファイル
- **define-feature で起動されたが、純UIのため requirements.md は作らず design-spec を改訂した**（[[feedback_design_spec_is_requirement_for_ui]]）

## round 1〜3（PR #648）の要点

- 北溟（『荘子』の北の大海）を **白波・海面・深み** の 3 層として読み、surface 純白 / canvas / brand 紺 `#15387d` に割り当てた
- メリハリの本体は明度ラダー（カード↔地の ΔL 0.07 以上）。brand L 0.36（白の上で 11.1:1）
- 不採用: A2 濤（brand と見出しの墨の明度差が 0.022 しかない）・A3 藍墨（朱・山吹の文字が浮く）・B 藍染の色階。C 藍 × 雪は「地は水色」の要望で落としたが、round 4 でその要望は緩んだ
- 「純白は使わない」原則は撤回済み。`bg-white` / `text-white` の例外 6 箇所は surface と同値でも `bg-surface` へ置換しない
- hex 照合は無効（`success == brand`・`danger == accent`・`surface == ink-on-brand == white`）。照合は参照名で行う
- `globals-tokens.test.ts` が 2 系統（`@theme` ⇔ `:root --kg-*`）の同値と spec 値を固定している

関連: [[project-kagetra-color-tokens]]（round 4 出荷時に canvas 系の値を更新する）・[[ship-hokumei-palette]]
