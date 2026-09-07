---
name: ship-series-nickname-link
description: 承認画面の通称⇄系列 相互連動
type: project
---

## 出荷

**PR #605**: feat: 承認画面の通称と系列を相互連動させる（mail-ai-extract-refinements）
https://github.com/poponta2020/kagetra_new/pull/605 — **merged**（CI pending のままマージ。赤になったら追修正）

クローズした Issue: #599（親）/ #600 / #601 / #602（PR 本文の closing keyword による自動クローズ）

## 何を出したか

承認画面（`/admin/mail-inbox/[id]`）で「通称」と「系列」に同じ語を二度打っていた状態の解消。通称の実体は `tournament_series.short_name` で、元から同じ概念だった。**マイグレーション不要・AI 呼び出しは増やさない**（DB 照合のみ）。

- 名寄せ候補が1件なら系列を選択済みにし、その `short_name` を通称欄へ自動投入（由来を表示）
- 通称欄への入力が系列候補チップになる。タップで系列確定＋`editionLink` ON、**通称欄の文字は書き換えない**
- シートで系列を選ぶと通称欄が空なら `short_name` が入る
- 系列検索の照合対象に `short_name` を追加（自動解決の `scoreSeries` は不変）
- 新規系列作成時だけ通称を `short_name` として保存（既存系列は書き換えない）
- 回次パースの漢数字対応

## ★出荷後に効いてくること

1. **開催紐付けが既定 ON になる範囲が広がる**（実測31件中16件で候補が当たる）。`tournament_series_editions` の行作成と `events.edition_id` 設定が既定で走るようになる。意図した挙動変化だが、本番で「作られすぎ」の兆候が出たら初期選択条件を見直す
2. **残 DoD（AC-63・運用作業）**: 本番の `short_name` が null の2系列を埋める。SSH 経由の psql で
   `UPDATE tournament_series SET short_name = '九段' WHERE id = 182 AND short_name IS NULL;`
   `UPDATE tournament_series SET short_name = '初心者' WHERE id = 181 AND short_name IS NULL;`
   実測で直近31件中3件がこの2系列。埋めると候補が出るようになる
3. **AC-59（大会一覧・選手戦績の通称表示が不変）はローカル未実行**で CI に委譲した

## レビュー

3ラウンド（initial 1 / delta 1 / final 1）・verdict=cutoff・累計 322,205 トークン・effort m→h→m。

- R1 blocker「4桁の漢数字回次が読めない」→ 修正（`80bf679`）、R2 で解消確認
- **R3 blocker は WONTFIX**: 位取りが不正な漢数字（「第十二十回」=30・「第百百回」=200）を受理する。今回の漢数字対応で入った退行だが、実在の大会名に壊れた漢数字は現れず、承認画面に回次の入力欄が見えているためユーザー判断で見送り。**本番で「回次がおかしい edition」が出たらこの見送りを疑う**
- 再レビューせずに修正した指摘: なし

## 要件定義書の訂正

AC-47・§3.2.9(a) の初期選択条件を「候補1件のときだけ」から「**完全一致が単独** または **候補が1件**」の2分岐へ訂正した（文字どおり実装すると、緩和のはずが現行の自動選択を狭めるため）。tournament-entry-rosters の相互参照も「置き換え」→「追加」へ訂正。
