---
name: feature-def-hokumei-palette
description: 北溟配色の design-spec 確定。白波・海面・深みの3層読み。不採用案と前回取り残しのリテラル箇所を記録
type: project
---

# 北溟配色（白波 × 紺）design-spec 確定 / 出荷済み（PR #648）

**日付**: 2026-09-21
**正典**: `docs/features/hokumei-palette/design-spec.md`（`status: locked`）
**検証スクリプト**: `docs/features/hokumei-palette/palette-check.mjs`（依存なし。全数値を再導出・再実測。exit 0 が合格）
**状態**: 出荷済み（PR #648・2026-09-21 マージ）。残 DoD = 本番の実画面確認 5 項目（[[ship-hokumei-palette]]）

## 決まったこと

アプリ名が北溟に確定し（PR #639）、藤 × 墨の根拠（ライラック）が消えたため配色を刷新する。ユーザー要望は「北の海・藍と白・地は水色でよい・藍は濃いものも・白はもっと白く・メリハリ」。

### 中心的な設計判断

北溟（『荘子』の北の大海）を **白波・海面・深み** の 3 層として読み、`surface` 純白 / `canvas` 水色 `#d3eafa` / `brand` 紺 `#15387d` に割り当てる。百人一首 76 番の結句「沖つ白波」が題材の内側にある像なので、design.md の「古典的な題材に古典のトーン」の論の中に収まる。

### メリハリの本体は明度ラダー

初回案 A が「のぺっと」していた原因は測定できた。カード↔地の ΔL 0.046・地の彩度 0.016（水色と呼べない）・brand の明度が初代の藍と同じ 0.42。採用した A1 は ΔL **0.075**（下限 0.07）・地の彩度 0.033・brand L **0.36**（白上 11.1:1）。

### 不採用案（蒸し返し防止）

- A2 濤（brand を留紺 L 0.31・地の彩度 0.045）: brand と見出しの墨 ink-2 の明度差が 0.022 になり、ボタンと見出しの階層が色で読めなくなる。**地の水色 `#c6e8fc` だけは A1 が実画面で物足りなかった場合の調整先として残してある**
- A3 藍墨（文字色まで濃紺）: 朱・山吹の文字だけ暖色として浮き、警告の強度が意図せず上がる
- B 藍染の色階（淡い面ほど青緑）・C 藍 × 雪（無彩色の地）: 初回で A に敗退

## 実装前に必ず読むこと

- **「純白は使わない」原則を撤回する**（design.md の視覚原則）。surface = `#ffffff`。A1 の選択がユーザー承認にあたる
- **`bg-white` / `text-white` の例外 6 箇所は surface と同値になるが `bg-surface` へ置換しない**。「surface がどう変わっても白」であるべき箇所で意味が違う
- **hex 照合はさらに無効になる**。`success == brand`・`danger == accent` に加えて `surface == ink-on-brand == white` が衝突する。照合は参照名で
- 朱・山吹の 6 トークンは**値を変えない**。根拠の説明だけ差し替える（山吹＝紺のほぼ補色 171°。「和紙の記憶」は失効）
- 影は構造・alpha とも据え置き、基色だけ `rgba(45,38,70)` → **`rgba(23,43,73)`**。前回 alpha を上げたのは canvas が暗くなったためで、今回 canvas の L は 0.930 → 0.925 とほぼ同じ
- トークン名は 1 つも増減させない。コンポーネントの className も変えない
- **リテラルで色を持つ箇所が追随しない**: `layout.tsx` の themeColor、`lib/line-flex-mail-body.ts` の BADGE_COLOR（テストが hex 固定）、`lib/open-chat/flex.ts` の FLEX_BTN_BG（**初代の藍 `#2B4E8C` のまま前回取り残されていた**）、`lib/stats/grade-tones.ts`（**「藍→砂」ランプも前回取り残し**。紺→水色鼠へ引き直す）
- docs の腐り: `docs/design/ui_kits/kagetra-mobile/palette.css`・`design-system-readme.md`・`SKILL.md` は**初代（和紙 × 藍墨）の値のまま 2 世代放置**されていた。brand が藍へ戻ると「ほぼ正しいが hex が違う」状態になりかえって危険なので、palette.css は機械更新、残り 2 つは冒頭に注記 1 つ
- 新設テスト `apps/web/src/app/globals-tokens.test.ts` で 2 系統（`@theme` ⇔ `:root --kg-*`）の同値と spec 値を固定する。名前対応は `canvas`↔`bg`・`ink*`↔`fg*`・`ink-meta`↔`fg-3`・`line*`↔`line-green*`
- 成果物 3 ファイルは main に **untracked**。`/implement` の worktree 作成直後に cp してコミットする

## 実画面でしか確認できない項目（出荷後に本番で）

地の水色の強さ（375px 全面）／純白カード上の影の alpha／テクスチャの見え方／`--kg-nonattend` の見え方／LINE トーク上の Flex の紺

## 関連して決まった副次事項

- アプリアイコン差し替え（別タスク）の地色は brand `#15387d`
- 会員向けガイド PDF の紫配色は、本 spec の brand 系へ寄せればよい（別作業。「藍へ戻すか保留」の判断材料が揃った）

関連: [[project-kagetra-color-tokens]]（出荷時に更新が必要）・[[project_lilac_palette_direction]]（前回の刷新）
