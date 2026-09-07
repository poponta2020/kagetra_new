---
name: feature-def-series-nickname-link
description: 承認画面の通称⇄系列連動 要件定義(2026-09-07)
type: project
---

## 機能

`mail-ai-extract-refinements` の改修（2026-09-07）: 大会案内の承認画面で「通称」と「系列」に同じ語を二度打つ状態の解消。要件定義は既存の [[project_mail_ai_extract_refinements_def]] と同じ slug の生きた仕様（requirements.md §3.2.9〜3.2.11）へ追記した。

## ★本番実測（要件を決めた根拠。直近31ドラフト）

- **「DB の通称リスト」の実体 = `tournament_series.short_name`**（migration 0038 で投入済み・個人戦182件中180件が非 null）。承認画面の「通称」と同じ概念だった
- 正式名称→名寄せ→その系列の通称 が人の入力と一致: **16/31**（候補提示込みで約7割）
- 打った通称で系列検索してヒット: **23/31**（0件の8件は系列マスタに存在しない大会＝鳳玉・熊本地震チャリティー・大学生選手権など）
- 実際に系列へ紐付いている: **7/31**。ユーザー回答による理由は「手間だからスキップ」＝本機能の裏の目的は紐付けの操作コスト削減
- 不一致14件の内訳: (a) マスタに無い大会7件 (b) `short_name` が null の新規作成系列3件（九段×2・初心者） (c) 会と DB の表記ずれ4件（人「椿杯」/DB「椿」、人「東京吉野会」/DB「吉野会」。同じ大会で人の打ち方自体も揺れている）
- 検証は使い捨てスクリプト `scripts/diagnostics/series-suggest-sim.ts` / `nickname-to-series-sim.ts`（本番 series と drafts を JSON 化し、実コードの純関数を tsx で直接呼んで再現）

## 主要な設計判断

- **AI を使わない**（ユーザーの当初要望は「AI が候補を出す」だった）。不一致の主因はマスタ欠落・表記の好みで、AI を足しても埋まらない種類の不足だと実測で示せたため。§3.2.3 で `short_name_stem` を AI から人力へ戻した過去判断とも整合。不足が残れば別機能で再検討
- **初期選択の条件を「完全一致1件」→「名寄せ候補1件」へ緩和**。実測では完全一致がごく少数で、旧条件では自動化がほぼ効かない。★これは [[project_tournament_entry_rosters_series_search]]（tournament-entry-rosters AC-1/AC-2）の上書きで、両方の requirements に相互参照を書いた
- **検索側だけに `short_name` を足す**。`searchSeriesCandidates`（一方向・管理者検索）と `scoreSeries`/`rankSeriesCandidates`（双方向包含・自動解決、結果取込 flow② も使う）は PR #292 で意図的に分離した契約なので、後者は触らない
- **通称と系列は別々の値のまま**（系列=ID / 通称=表示文字列）。統合すると会の表記が消えるか DB の正準値が汚れる。空欄を埋める方向にだけ自動を効かせ、人が入れた値は上書きしない。通称を打ち直しても系列選択は外れない
- **`short_name` の書き込みは新規系列作成時のみ**。既存系列を承認のたびに書き換えると、大会一覧（年別）と選手戦績の通称表示が承認操作の副作用で変わる
- 回次パースを漢数字対応（「第三回」。実例=杉並がこれで紐付け不可だった）。年式表記（九段2026-2）は Non-goal
- マイグレーション不要・`design_required: false`

## Acceptance Criteria

今回追加分は AC-45〜AC-63 の19件（auto-test 18 / manual 1）。回帰は「大会一覧・選手戦績の通称表示が不変」「自動解決スコアリング不変」「系列選択の既存安全策3点（検索語だけでは確定しない／種別不一致は拒否／新規作成は明示確認）が維持」。

## GitHub Issue

- 親 #599: https://github.com/poponta2020/kagetra_new/issues/599
- 子 #600: タスク1 系列マスタの通称を検索・名寄せ・作成に通す（lib/edition 層）＝ Wave 1
- 子 #601: タスク2 承認フォームの通称⇄系列連動（UI）＝ Wave 2
- 子 #602: タスク3 新規系列作成時に通称を `short_name` として保存する（Server Action）＝ Wave 2

Wave 2 の2タスクは `components/**` と `actions.ts` で変更領域が重ならないため並行可。hidden field `editionSeriesShortName` はタスク2 が作りタスク3 が受けるので、AC-55 の成立は両方が揃ってから。

## 出荷後の運用作業

AC-63: 本番の `short_name` が null の2系列（id=182 九段 → 「九段」／id=181 北海道競技かるた初心者大会 → 「初心者」）を UPDATE 2行で埋める。実測で直近31件中3件がこの2系列。
