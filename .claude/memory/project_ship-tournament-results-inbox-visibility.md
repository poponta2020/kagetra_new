---
name: ship-tournament-results-inbox-visibility
description: 受信箱の結果取込を「押したら消える → 承認待ちで復活」にする
type: project
---

PR #640 — https://github.com/poponta2020/kagetra_new/pull/640（merge commit d4efe71）。tournament-results の 2026-09-13 改修「メール結果取込を押したら受信箱から消える → 承認待ちで復活」。親 Issue #632 クローズ・子 #633-637 は closing keyword で自動クローズ。

## 何を出したか

`/admin/mail-inbox` の結果取込の起点と承認導線を一覧に可視化した。**`triage_status` は書き換えず**、未処理判定に「結果取込が進行中のメールを除外する」条件を重ねる方式（書き換えると会員向け `/mail` に「対応不要として処理」と誤表示されるため）。マイグレーションなし。

- 取込中（未終端 `result_parse` ジョブが30分以内）は未処理・処理済みの両セクションから WHERE 句で除外
- `pending_review`（承認画面へ直リンク）/ `parse_failed` / 30分超の滞留 で未処理へ復活し状態ピルを1つ出す。並びは受信日降順のまま
- 未処理件数を数える5経路を `countUnprocessedMails` に統一
- 「対応不要」ガードを結果ドラフトへ拡張（一覧・詳細・`dismissMail` が同じ純関数 `resultImportBlocksDismiss` を通る）

## ★senseki-boundary の形

結果取込ドメインの知識は `packages/shared/src/queries/result-import-visibility.ts`（削除可能な葉）に閉じ、件数ヘルパーは `unprocessed-mails.ts`（配線点）に分けた。配布版で切り離すときは葉を削除し、`unprocessed-mails.ts` の import 1行と `hiddenMailIds` を空配列にする1行を外せば現行挙動へ縮退する。**実装手順書は4エクスポートを1ファイルに置く想定だったが、要件 §6「削除すると呼び出し側は空集合で縮退」を満たすため2ファイルに割った**（同居させると葉の削除に5箇所の書き戻しが要る）。

## レビュー（3R = initial + delta + final・verdict=pass・累計 333,214 tokens・effort 全ラウンド medium）

- **R1 blocker 1件を修正**: 結果取込の完了 Web Push が `runResultParse` の内側にあり、dispatcher の `markJobDone` より先に badge を数えていた。ジョブが `claimed` のままなので `countUnprocessedMails` が**完了メール自身を取込中として除外**し、通知が届いた瞬間の badge が実際より1件少なくなる（通常経路で必ず発生）。通知を `markJobDone` 直後へ移設して根治。
- **R1 blocker 1件を WONTFIX（ユーザー判断）**: `dismissMail` の新ガードが `triggerResultParse` / worker のドラフト確定と直列化されていない。同一メールへの同時操作が必要な競合で、**既存の `tournament_drafts` ガードも同じ構造**なので直すなら両方まとめて別 Issue。最悪ケースも「未処理に戻す」で復旧可能。
- 再レビューせずに修正した指摘: 0 件（R3 final が最終形を見て pass）。

## ★残タスク・既知の穴

- **AC-37（manual・未実施）**: 本番で実メール1通を「取込 → 一覧から消える → 完了後に承認待ちで復活 → 承認」まで実機確認する
- **CI pending のままマージ**（v0.9.0 方針）。赤なら追修正
- **スコープ外の穴（別 Issue 候補）**: メール詳細の統合処理フォームは `showProcessForm = !mail.draft && triageStatus === 'unprocessed'` のままなので、`pending_review` の結果ドラフトを持つメールでも `processMail`（種別＋紐付けの実行）経由なら processed にできる。`tournament_drafts` ならフォームごと出ないので非対称。改修前から到達可能で要件の名指し外のため今回は直していない
- **AC-31 の既存差分**: 述語は統一したが、一覧見出しの「未処理 (N)」は描画行数（`ACTIVE_LIMIT=100` 上限）、バッジ API は真の `COUNT(*)` なので100件超では改修前から食い違う（今回の変更が生む差ではない）

関連: [[impl-tournament-results-inbox-visibility-task1]] [[impl-tournament-results-inbox-visibility-task2-5]] [[auto-review-round-pr640]] [[feedback-vitest-close-test-db-per-describe]]
