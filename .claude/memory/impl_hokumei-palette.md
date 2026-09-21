---
name: impl-hokumei-palette
description: hokumei-palette 実装（タスク1-5）
type: project
---

# hokumei-palette 実装（タスク1-5・全 main 直列）

**worktree**: C:/tmp/impl-hokumei-palette（branch feature/hokumei-palette）
**コミット**: b4fdb3e(成果物) / 7af8ee4(T1 globals.css+globals-tokens.test.ts) / 96271c8(T2 リテラル) / 5c2ce99(T3 級トーン) / cd416e3(T4 docs) / 6dd8596(T5 §8 照合)
**委譲**: なし（全タスク小径のため main 直列。計画どおり）

## 実装内容
- globals.css の @theme と :root --kg-* を A1 白波へ同時更新。影は `rgba(45, 38, 70, ` → `rgba(23, 43, 73, ` の literal 置換（同じ文字数なので折り返しが崩れない）。コメント内の実測値を全て新値へ
- 新設 apps/web/src/app/globals-tokens.test.ts: @theme/:root を行頭 `}` まで切り出しコメント除去→正規表現で抽出。ミラー照合は**名前対応表駆動**（:root には nonattend・pill の var()・フォント等があり「全 --kg-* に対がある」前提は成り立たない）。hex 値の --kg-* 集合 == ミラー + nonattend でトークン増減 0 も固定
- themeColor #d3eafa / BADGE_COLOR・FLEX_BTN_BG #15387d（flex.test.ts にボタン色の検証を1件追加）/ 級トーン紺→水色鼠
- docs: design.md §5 の7項目・colors_and_type.css（大文字 hex の慣習は維持、値は case-insensitive で 33 トークン全一致）・palette.css 機械更新・readme/SKILL は冒頭注記のみ・docs/spec 2 箇所・INDEX

## 注意点・発見
- **Docker 停止中でもピュアテストは回せる**: apps/web の vitest.config は globalSetup と setupFiles の両方でテスト DB に接続するため ECONNREFUSED で全滅する。scripts/diagnostics/vitest.pure.config.mjs（imports 無しの素の object・alias '@/'→src/・environment node）で DB 非依存テストだけ回した
- vitest に `src/app/xxx.test.ts` のフルパスを filter で渡すと Windows で No test files found になった。ファイル名の一部（`globals-tokens`）で渡すと通る
- **生成 CSS 照合は @tailwindcss/postcss を直接叩けば数秒**（scripts/diagnostics/compile-globals.mjs。createRequire(apps/web/package.json) で postcss と @tailwindcss/postcss を解決）。--color-* は 33 個とも出力、影は `--tw-shadow: ... var(--tw-shadow-color, rgba(23, 43, 73, α))` の形で出る（--shadow-* 変数名では出ない）
- colors_and_type.css には --kg-nonattend が main 時点から無い（今回の差分ではない。放置）
- 計画は .claude/memory/project_kagetra_color_tokens.md を更新先としていたが、実体はローカル auto-memory にしか無かった（repo 側に未同期）。ローカル側を更新した

## 検証
- targeted vitest 4 ファイル 117 件 green（DB 非依存 config）・eslint 変更ファイル exit 0・palette-check.mjs exit 0・生成 CSS 照合済み
- フルスイート・typecheck はローカル未実行（CI に委譲）
- 実画面項目（水色の強さ・純白カード上の影・テクスチャ・nonattend・LINE Flex の紺）は**未確認**
