---
name: ship-fix-undefined-warn-token
description: 未定義トークン warning / border-warn の修正（PR #531 の残作業2件）
type: project
---

**PR #532** fix(ui): 未定義トークン warning/warn を warn-fg・warn-bg へ置換
https://github.com/poponta2020/kagetra_new/pull/532

[[ship-fix-undefined-ink-token]]（PR #531）の監査で発見し、同 PR のスコープ外として残した 2 件を解消。`globals.css` に `warning` というトークンは一切存在せず、`warn` も `--color-warn-bg` / `--color-warn-fg` の 2 つだけでスカラーの `--color-warn` は無い。

| ファイル | before | after |
|---|---|---|
| `TournamentSeriesSelectSheet.tsx:165` | `border border-warning/30 bg-warning/10` | `border border-warn-fg/30 bg-warn-bg` |
| `mail-inbox/[id]/page.tsx:349` | `border-warn` | `border-warn-fg/30` |

**影響**: 前者は背景の警告色が出ないうえ、素の `border` により枠線が `currentColor`（≒ `text-ink` の黒 #1e1b13）になり、「同じ名前の系列が別の大会種別で登録されています」の警告ボックスが**黒枠・無地の箱**として描画されていた。後者は `bg-warn-bg` / `text-warn-fg` は効いており枠線色だけ Card 既定（`border-border`）のまま＝軽微。

**★fix 1 は idiom から意図的に外している**: この木の `<p>` 警告ボックスは全件が枠線なし・`text-warn-fg`（self-identify:67 / Step3Mail:81 / Step1Template:385,392 / MemberEditSheet:83）。今回はトークン置換のみに留めるため元の `border` と `text-ink` をそのまま残した。枠線の有無と本文色の 2 点で idiom から外れているのは既知のうえでの見送り。fix 2 は既存の警告カード idiom（roster-drafts/[id]/page.tsx:224,281 の `border-warn-fg/30 bg-warn-bg`。danger 系も `border-danger-fg/30 bg-danger-bg` が 5 箇所）と完全一致。

**検証**: PR #531 の全ツリー照合と違い、**対象ファイル 1 件だけをスキャンさせた**（`@import "tailwindcss" source(none);` + `@source`）。`bg-warn-bg` は約 15 箇所、`border-warn-fg/30` は roster-drafts が既に使用しているため、全ツリーでは「出力されている」ことが当該呼び出し箇所の判定材料にならない。**バイト単位同一による証明（PR #531 の手法）もここでは使えない** — 両クラスとも他ファイル由来で既に出力済みのため、差分ゼロは「壊していない」ことしか示さない。手順の詳細は [[feedback-tailwind-v4-undefined-token-silent]]。

- before: 3 クラスとも literal でソースにあるのに未出力（握り潰しを実証）。素の `.border` が `border-width: 1px` のみで色指定なしであることも確認
- after: 2 クラスとも出力され、hex ではなく `var(--color-warn-fg)` / `var(--color-warn-bg)` を参照
- 両ファイルを全カラーユーティリティで sweep → 他の握り潰しゼロ。全ツリーに `warning` 参照と裸の `warn` カラーユーティリティは残っていない

**コントラスト**: 本文 `ink` on `warn-bg` = 14.22:1（AA 4.5 以上）。枠線 `warn-fg/30` → #d8afa8 on `warn-bg` = 1.64:1 で非テキスト 3:1 は下回るが、fix 2 の従来枠線 `border-border` on `warn-bg` は 1.31:1 で**むしろ改善**。fix 1 の従来枠線（黒 16.07:1）はバグそのものでベースラインではない。**どちらにも回帰なし**。意味は背景の色味と太字の ⚠ 見出しが担っており枠線単独ではない。

**レビュー**: ユーザー判断で **Codex レビューなし**（2 行の className 置換・検証は生成CSS照合で完了のため）。CI pending のままマージ。

**lint / typecheck / vitest 未実行**: worktree に node_modules が無いため。当該クラスを参照するテストは grep でゼロ。そもそも本バグ種は 4 ゲートとも green になるため診断能力がない（CI で担保）。

**★残DoD**: 実機確認。系列選択シートの警告ボックスが黒枠でなく警告色の面で出ること（`/admin/mail-inbox` の大会系列選択で同名・別種別の系列があるケース）。

根本対策の掃討スクリプト CI ガード化は**未実施**（別タスク）。
