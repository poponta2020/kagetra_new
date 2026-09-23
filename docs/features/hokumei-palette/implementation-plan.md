---
status: completed
round: 4
---
# 北溟配色 round 4（地の青みを落とす）実装手順書

**要件の正**: `design-spec.md`（UI リデザインのため design-spec が要件成果物。requirements.md・GitHub Issue は無い）。round 4 の範囲は §1「round 4」・§2.1・§5〜§10 の「round 4」節
**slug**: `hokumei-palette`
**ブランチ**: `feature/hokumei-palette-round4`
**検証スクリプト**: `node docs/features/hokumei-palette/palette-check.mjs`（依存なし。exit 0 が合格。round 4 の値へ更新済み）

本手順書の「対応チェック」は design-spec §8「round 4」の忠実度チェックリストの項目を指す（AC の代わり）。round 1〜3 のタスク（PR #648 で完了）は git 履歴にある。

**着手前（必須）**: round 4 の改訂 3 ファイル（`design-spec.md`・`implementation-plan.md`・`palette-check.mjs`）は main の作業ディレクトリに未コミットの変更（` M`）として置かれている。worktree には round 3 の古い版がコミット済みで存在するため、「無ければ cp」では素通りする。worktree 作成直後にメイン作業ツリーの版と diff し、cp で上書きして最初にコミットする（design-spec §9）。

## 変更する値（design-spec §2.1）

| トークン（`@theme` / `:root`） | A1（現行） | round 4 |
|---|---|---|
| `--color-canvas` / `--kg-bg` | `#d3eafa` | `#dfe8ed` |
| `--color-surface-alt` / `--kg-surface-alt` | `#c3ddf0` | `#d1dbe2` |
| `--color-border-soft` / `--kg-border-soft` | `#bdd5e6` | `#cad2d9` |
| `--color-border` / `--kg-border` | `#a8c2d6` | `#b6bfc7` |
| `--color-border-strong` / `--kg-border-strong` | `#839bb3` | `#9099a2` |

これ以外の値は 1 つも変えない。

## 実装タスク

### タスク1: 正典（globals.css）・トークン同期テスト・themeColor の更新
- [x] 完了
- **目的:** 面と枠線のラダー 5 トークンを round 4 値へ差し替え、機械検証を round 4 値で通す
- **対応チェック:** §8 round 4 の 1〜7・9（globals.css 側）・10
- **主な変更領域:** `apps/web/src/app/globals.css`、`apps/web/src/app/globals-tokens.test.ts`、`apps/web/src/app/layout.tsx`
- **依存タスク:** なし
- **必要なテスト（先に書く）:** `globals-tokens.test.ts` の spec 値 5 つ（`canvas`・`surface-alt`・`border-soft`・`border`・`border-strong`）を round 4 値へ直し、red を確認してから globals.css を直す。2 系統の同値・同値関係・据え置き値の検証は既存のまま効く
- **実装の要点:**
  - `@theme` と `:root` を**同時に**更新する（片方だけだと 2 系統の同値検証が落ちる）
  - コメントを直す: ヘッダの「海面 canvas（ページの地） 水色」→「水色鼠」、Surfaces 節の ΔL（0.075 / 0.041 → 0.074 / 0.040）と各行末の L・ΔL 注記。「canvas の彩度は 0.033。これを下回ると水色と読めない。」は削除し、代わりに round 4 の理由を書く（背景の青みが実画面で強すぎたため、明度は据え置いて彩度だけを 0.375 倍にした。明度を上げるとカードとの ΔL が下限を割る）
  - `layout.tsx` の `themeColor` を `#dfe8ed` へ。コメントの「canvas 水色」→「canvas 水色鼠」
  - `globals-tokens.test.ts` の `SPEC` 直前のコメント「design-spec §2 の確定値（A1 白波）」を round 4 の値である旨へ直す。このテストは hex の値だけを固定しており、ΔL・コントラスト・コメント文の検証は持たない（round 4 で壊れる派生アサーションは無い）
  - トークン名・className・Baseline 以降（`.mobile-shell-h` ほか）は触らない
- **完了条件:** `globals-tokens.test.ts` が green。`palette-check.mjs` が exit 0。`git diff apps/web/src/app/globals.css` で値の変更がちょうど 10 行。生成 CSS に 5 トークンの `--color-*` が round 4 値で出力されている
- **対応Issue:** なし

### タスク2: デザイン文書の同期
- [x] 完了
- **目的:** globals.css のコピーと design.md を round 4 値へ揃え、A1 のラダー値を docs から消す
- **対応チェック:** §8 round 4 の 8・9（colors_and_type.css 側）
- **主な変更領域:** `docs/design/colors_and_type.css`、`docs/design/ui_kits/kagetra-mobile/palette.css`、`docs/design/design.md`
- **依存タスク:** なし（値は design-spec が正。タスク1とファイルが重ならない）
- **必要なテスト:** なし（文書のみ）。完了条件の grep で確認する
- **実装の要点:**
  - `colors_and_type.css`・`palette.css`: 5 値の置換と、ΔL のコメント（0.075 → 0.074 ほか）
  - `design.md`: design-spec §5「round 4 で直す箇所」の 7 点。視覚原則「White-crest surfaces」に「明度を上げて青みを消そうとすると ΔL の下限を割る」の一文を足す
  - hex の大文字小文字は各ファイルの既存表記に合わせる（design.md・colors_and_type.css・palette.css は大文字）
- **完了条件:** `git grep -n -i "d3eafa\|c3ddf0\|bdd5e6\|a8c2d6\|839bb3" -- docs/design` が 0 件（タスク1 と合わせた最終確認は `-- apps docs ':!docs/features/hokumei-palette' ':!docs/worklog.md'` で 0 件）
- **対応Issue:** なし

## 実装順序（Wave）
- Wave 1: タスク1, タスク2（変更領域が重ならない。タスク1 = `apps/web/src/app/`、タスク2 = `docs/design/`）

## 出荷後（残 DoD。本番 375px で確認し、未確認として報告する）
design-spec §7「round 4 の実画面確認」の 5 項目。地が寂しすぎる場合の調整先は案2 `#dde8f0`（`LADDER_CHROMA` 0.5）で、明度は動かさない。
