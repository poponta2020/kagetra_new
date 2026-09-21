---
status: completed
---
# 北溟配色（白波 × 紺）実装手順書

**要件の正**: `design-spec.md`（UI リデザインのため design-spec が要件成果物。requirements.md・GitHub Issue は無い）
**slug**: `hokumei-palette`
**ブランチ**: `feature/hokumei-palette`
**検証スクリプト**: `node docs/features/hokumei-palette/palette-check.mjs`（依存なし。exit 0 が合格）

本手順書の「対応チェック」は design-spec §8 忠実度チェックリストの項目を指す（AC の代わり）。

## 実装タスク

### タスク1: `globals.css` の全面更新とトークン同期テスト
- [x] 完了
- **目的:** 配色の正典を A1 白波へ差し替える。あわせて 2 系統の同値と spec 値との一致を機械検証できるようにする
- **対応チェック:** §8 の 1〜6・11・12
- **主な変更領域:** `apps/web/src/app/globals.css`、`apps/web/src/app/globals-tokens.test.ts`（新設）
- **依存タスク:** なし
- **必要なテスト（先に書く）:** `globals-tokens.test.ts`。`globals.css` をファイルとして読み、正規表現で `@theme` ブロックの `--color-*` と `:root` ブロックの `--kg-*` を抜く。検証するのは (a) design-spec §2 の全値との一致、(b) 2 系統の同値（名前対応 `canvas`↔`bg`・`ink`↔`fg`・`ink-2`↔`fg-2`・`ink-meta`↔`fg-3`・`ink-muted`↔`fg-muted`・`ink-on-brand`↔`fg-on-brand`・`line`↔`line-green`・`line-hover`↔`line-green-hv`、ほかは同名）、(c) 同値関係（`success*`==`brand*`・`danger*`==`accent*`・`info-fg`==`neutral-fg`・`ink-on-brand`==`surface`）、(d) 据え置き 8 値（朱 3・山吹 3・LINE 緑・`--kg-nonattend`）、(e) 影 3 本が `rgba(23, 43, 73,` を基色に 2 層であること。globals.css を読む既存の前例は `components/layout/mobile-shell.test.tsx`
- **実装の要点:**
  - `@theme` と `:root` を**同時に**更新する（片方だけだと (b) が落ちる）
  - ヘッダコメント（藤 × 墨の説明）を design-spec §1 の読み方へ書き換える
  - **コメント内の実測値を全て書き換える**: Surfaces 節の L と ΔL、Ink 節のコントラスト 3 値（6.78 / 5.46 / 4.82）と ink-muted（3.10）、Brand 節の導出説明、Semantic 節の山吹の根拠、Shadows 節の「藤みの影」と alpha を引き上げた経緯（今回は据え置きである旨）、`--kg-nonattend` の「藤 #534286 との比 4.82:1・色相差 274°」→「紺 #15387d との比 6.34:1」
  - トークン名は 1 つも増減させない。Baseline 以降（`.mobile-shell-h` ほか）は触らない
- **完了条件:** `globals-tokens.test.ts` が green、`palette-check.mjs` が exit 0、生成 CSS に全 `--color-*` が §2 の値で出力されている
- **対応Issue:** なし

### タスク2: コード内リテラルの追随
- [x] 完了
- **目的:** CSS 変数を使えない箇所の色を新 brand / canvas へ揃える
- **対応チェック:** §8 の 5・7・8
- **主な変更領域:** `apps/web/src/app/layout.tsx`、`apps/web/src/lib/line-flex-mail-body.ts` と同 `.test.ts`、`apps/web/src/lib/open-chat/flex.ts`、`apps/web/src/app/(app)/events/EventListClient.tsx`（コメントのみ）、`apps/web/src/components/events/detail/TravelReportCta.test.tsx`（テスト名の表記のみ）
- **依存タスク:** タスク1（値の確定）
- **必要なテスト（先に書く）:** `line-flex-mail-body.test.ts` の hex 期待値を `#15387d` へ。`open-chat/flex.ts` のボタン色は現状テストが無いので、既存の `flex.test.ts` にボタンの `color` が `#15387d` であることの検証を 1 件足す
- **実装の要点:** `themeColor` のコメント「canvas 藤鼠」を直す。`EventListClient` のコメントは新値（neutral-bg `#d8dde2`・白 1.37:1）へ書き換え、「`surface` も純白になったが、つまみは surface の変化に追随させないため `bg-white` のまま」と理由を更新する。`bg-white` 自体は残す
- **完了条件:** 上記テストが green。`git grep -n -i "534286\|e8e6f2\|2b4e8c" apps/web/src` が `grade-tones` 以外で 0 件
- **対応Issue:** なし

### タスク3: 統計の級トーンの引き直し
- [x] 完了
- **目的:** 取り残されていた「藍→砂」ランプを「紺→水色鼠」へ
- **対応チェック:** §8 の 9
- **主な変更領域:** `apps/web/src/lib/stats/grade-tones.ts` と同 `.test.ts`
- **依存タスク:** タスク1（A = brand の値）
- **必要なテスト（先に書く）:** `grade-tones.test.ts` の期待値を design-spec §4 の表へ。「A が brand と同値」「朱を含まない」の既存の意図は維持する
- **実装の要点:** doc コメントの「藍→砂トーンランプ」「E=砂（生成り）」を書き換える。`ALL_SERIES_TONE` は `#3d4958`。消費側 4 ファイル（stats の 2 page・`StackedComposition`・`GradeDots`）は import しているだけなので無変更
- **完了条件:** `grade-tones.test.ts` が green。`git grep -n -i "2b4e8c\|b8aa8a\|5b4f33" apps/web/src` が 0 件
- **対応Issue:** なし

### タスク4: ドキュメントの同期
- [x] 完了
- **目的:** 配色の第 2 コピーと設計書を新値へ。2 世代腐っているコピーに歯止めをかける
- **対応チェック:** §8 の 10
- **主な変更領域:** `docs/design/colors_and_type.css`、`docs/design/design.md`、`docs/design/ui_kits/kagetra-mobile/palette.css`、`docs/design/design-system-readme.md`、`docs/design/SKILL.md`、`docs/spec/notifications.md`、`docs/spec/events-attendance.md`、`docs/features/INDEX.md`
- **依存タスク:** タスク1
- **必要なテスト:** なし（docs）
- **実装の要点:** `design.md` は design-spec §5 の 7 項目。「純白は使わない」の撤回は**ユーザー承認済み**（A1 の選択がそれにあたる）。`design-system-readme.md` と `SKILL.md` は全面改稿せず、冒頭に注記を 1 つ置くだけ。`docs/spec` の 2 ファイルは色名表記（藤）を 1 箇所ずつ直すだけで、見出しや構成は触らない。main が担当する（設計書との整合判断を伴うため）
- **完了条件:** `git grep -n "藤" docs/design/design.md docs/design/colors_and_type.css` が経緯の説明文以外で 0 件
- **対応Issue:** なし

### タスク5: memory の更新と忠実度ゲート
- [ ] 完了
- **目的:** 偽になる記憶を直し、完了ゲートを通す
- **対応チェック:** §8 全項目
- **主な変更領域:** `.claude/memory/project_kagetra_color_tokens.md`
- **依存タスク:** タスク1〜4
- **必要なテスト:** なし
- **実装の要点:** 「参加/成功 = 藤」「success は緑ではなく藤」「純白を意図的に残した 6 箇所」（→ surface と同値になったが置換しない）「themeColor `#e8e6f2`」「hex 照合は無効」（→ `surface == white` の衝突が増えた）を更新する。design-spec §8 を 1 項目ずつ照合し、§7 の実画面項目は**未確認として報告**する
- **完了条件:** §8 の全項目にチェックが付く
- **対応Issue:** なし

## 実装順序（Wave）

- Wave 1: タスク1
- Wave 2: タスク2
- Wave 3: タスク3
- Wave 4: タスク4
- Wave 5: タスク5

全タスクを **main 直列**で実装する。タスク2〜4 は変更領域が重ならないが、いずれも数箇所の編集で終わる小径のタスクで、task-implementer 起動のオーバーヘッドの方が高くつく（`lilac-palette` と同じ判断）。タスク4 は設計書との整合判断を伴うため、いずれにせよ main の担当になる。

## 検証方針

- **静的検証のみ**。dev サーバー・Browser による確認は行わない（実画面項目は design-spec §7 のとおり未確認として報告し、出荷後に本番で確認する）
- 検証は `var(--color-*)` の**参照名**で行う。hex 照合は同値関係が多く無効
- ローカルのフルスイートは実行しない（`DEVFLOW_CI_COVERS` 宣言済み）。各タスクの targeted テストと `palette-check.mjs` のみ

## 未確認として報告する項目

- 地の水色の強さ（375px 全面）
- 純白カード上の影の見え方（alpha）
- テクスチャの見え方
- `--kg-nonattend` の水色の面の上での見え方
- LINE トーク上の Flex の紺
