---
name: impl-entry-management-task34
description: entry-management タスク3・4
type: project
---

entry-management タスク3（#325・毎朝アラート delta）とタスク4（#326・ボード本体）を main 直で実装。worktree: C:/tmp/impl-entry-management。

## タスク3: entry-overdue-alert に attendCount >= 1
- 既存の相関サブクエリ attendCountExpr をそのまま and() の WHERE へ追加しただけ（SELECT と二重評価になるが数十行規模なので無視できる。HAVING/lateral への作り替えはしない）。commit e166dff
- **本当の作業は既存 8 テストの意図の保存**。条件追加で全ての positive フィクスチャが落ちる。createEventWithAttendee ヘルパーへ寄せ、**対象外を確認するテスト（締切当日・cancelled・過去・applied・not_applying・締切両方NULL）にも参加者を足した** — 出欠0名でも通ってしまうと、各テストが自分の切り分けたい条件を検証しなくなる（AC-29 が禁じているのはまさにこれ）。アサーションは 1 つも変更していない。

## タスク4: /admin/entries 本体（commit f850dd4）
- page.tsx はプロトタイプを適用せず**ゼロから書いた**（プロトタイプ版は proto-data 依存＋認証バイパス入り）。EntryBoardClient.tsx だけ patch から取り込み。
- クエリ 3 本: events+editions+series の leftJoin / eventAttendances の inArray / tournamentEntryRosters の inArray。母集団 0 件なら 2・3 を投げない。
- **★プロトタイプに 1 件バグがあった**: 空状態判定が items.length===0（取得行数）だった。要件 §3.2.1 の母集団は非表示条件を引いた後なので、全件が not_applying / 締切超過0名のときに 5 つの空区画が出てしまう。grouped の合計件数で判定するよう修正し、テストで固定した。
- テスト 30 件（page.test.tsx 15 / EntryBoardClient.test.tsx 15）。

## テストを書くときの罠（実際に踏んだ）
- displayName は「通称（なければ title）+ 対象級」を連結する。eligibleGrades を付けたイベントは getByText('タイトル') では引けない（'タイトルA' になる）。
- shortName に '本日' のような UI 文言と同じ文字列を使うと getByText が multiple elements で落ちる。
- 同名タイトルの行が 2 つあると getByRole('link', {name}) が multiple で落ちる。href 列挙で assert する方が安定。

## 検証
- 対象 4 ファイルのテスト green（entry-board-utils 63 / bottom-nav 21 / entry-overdue-alert 34 / EntryBoardClient 15 / page 15）。tsc --noEmit・eslint クリーン。git grep DESIGN-PROTO = 0 件。middleware.ts と (app)/layout.tsx に差分なし（確認済）。
- 共有テスト DB(5434) で truncateAll が一度 deadlock detected で落ちたが再実行で解消。並行して DB を触るプロセスがあると起こる。

## docs 正典の更新（同一コミット）
spec/events-attendance.md（画面＋5区画の判定表）/ spec/ui-shell.md（ボトムナビ 7 タブ表）/ spec/notifications.md（抽出条件に参加1名以上）/ SPECIFICATION.md / design/design.md / features/INDEX.md

## ★フルスイートで見つかった本物の破壊（追記）

`apps/web/scripts/__tests__/send-entry-overdue-alert.test.ts` の `seedOverdueEvent` が出欠を積まずにアラート対象を作っていたため、`attendCount >= 1` の追加で 4 件が落ちた（commit ea92273 で参加者 1 名を追加して修正）。

**取りこぼした理由**: consumer 調査で `apps/web/scripts/*.test.ts` しか見ておらず、`scripts/__tests__/` サブディレクトリを見落とした。vitest の include は `scripts/**/*.test.ts` なのでサブディレクトリまで拾う。**共有モジュールの抽出条件を変えたら `grep -rln <関数名> --include=*.test.ts` をリポジトリ全体に対して掛けること**（ディレクトリ直下の glob では足りない）。

## ★テスト DB を同時に 2 プロセスで叩くとどうなるか（実測）

フルスイートを 2 本並行させた結果 58 テストが落ちた。内訳は deadlock detected (40P01)・FK 違反（`Key (event_id)=(1) is not present in table "events"` = 相手の truncateAll に消された）・件数 0 の assertion。**全部ノイズで、本物は上記 4 件だけだった。** 単独実行では 116 files / 1506 tests 全 green。汚染された run の失敗を個別に追いかけるのは時間の無駄で、まず単独で回し直すのが正しい。
