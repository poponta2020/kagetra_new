---
name: impl-hokumei-palette-round4
description: 北溟配色 round 4 実装(2026-09-23)
type: project
---

北溟配色 round 4（地の青みを落とす）を worktree `C:/tmp/impl-hokumei-palette-round4`（ブランチ `feature/hokumei-palette-round4`）で実装完了。Wave 1 = タスク1・タスク2 を main 直で実装（各 ~15 行の機械的置換のため委譲せず）。

**変更**: 面と枠線のラダー 5 トークンの OKLCH 彩度を 0.375 倍（canvas `#d3eafa`→`#dfe8ed`、彩度 0.033→0.012）。明度・色相・他の全トークンは据え置き。

- タスク1 (7160b17): `apps/web/src/app/globals.css`（@theme + :root の 2 系統で値 10 行、ヘッダ/Surfaces 節のコメント）・`globals-tokens.test.ts`（SPEC 5 値）・`layout.tsx`（themeColor）
- タスク2 (4fd6969): `docs/design/colors_and_type.css`・`ui_kits/kagetra-mobile/palette.css`・`design.md`（7 箇所）
- 7f0ae01: round 4 改訂 3 ファイルを main 作業ツリーから cp して先頭コミット（design-spec §9 の指示どおり。worktree には round 3 の古い版が**コミット済み**で存在するため「無ければ cp」では素通りする）

**注意点・発見**
- globals.css の L 注記が spec とずれていた（canvas L 0.925→0.926、surface-alt 0.884→0.886）。彩度変更で hex を再導出した結果の実値なので合わせた
- 「値の変更がちょうど 10 行」は *値を持つ行* の意味。`--color-surface` の行はコメントのみの変更だが `--color-` を含むので、`grep '^+.*--color-'` で数えると 11 になる。hex で数えること: `git diff -U0 -- globals.css | grep -cE '^\+.*#(dfe8ed|d1dbe2|cad2d9|b6bfc7|9099a2)'` = 10
- 忠実度チェック 10（生成 CSS の実コンパイル照合）は `scripts/diagnostics/compile-tokens-check.mjs` を新規作成して実施（gitignored）。`@tailwindcss/cli` は依存に無いので postcss + `@tailwindcss/postcss` を直接叩く。**スクリプトを repo root の scripts/diagnostics に置くと node の ESM 解決が worktree の node_modules に届かない** → `createRequire(WT + '/apps/web/package.json')` + `pathToFileURL` で解決基点を移す。結果: 6 トークンが round 4 値で出力・`.bg-canvas` 等のユーティリティも生成を確認
- worktree は `corepack pnpm install` が必要（node_modules 無し）。`globals-tokens.test.ts` は純粋な readFileSync テストだが vitest global-setup がテスト DB を立てるので install 必須

**未確認（実画面）**: design-spec §7 round 4 の 5 項目（地の淡さ・テクスチャ・影の浮き・surface-alt 上の neutral/info ピル・PWA themeColor）。静的検証のみで完了ゲートを通した。寂しすぎた場合の調整先は案2 `#dde8f0`（`LADDER_CHROMA` 0.5）で明度は動かさない

関連: [[project-hokumei-palette-def]] [[project-kagetra-color-tokens]] [[feedback-tailwind-v4-undefined-token-silent]]
