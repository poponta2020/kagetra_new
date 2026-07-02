---
name: impl_event_list_refinements
description: 大会申込（/events 一覧）delta 改修の実装。3タスク実装完了・PR待ち（見出し改称/日付M-D曜/締切残日数3段階/締切既定ソート/申込可能フィルタ/参加者チップ）
metadata: 
  node_type: memory
  type: project
  originSessionId: a1ccf5e9-21f0-4a98-9e6c-2563bc6c0210
---

`/events`（イベント一覧）の delta 改修＝**「大会申込」**。design-spec B案（区切り線リスト）。**DBスキーマ変更なし・マイグレーションなし**。

**実装完了→PR/レビュー/ship 待ち**。branch=`feature/event-list-refine`・親#248＋子#245-247。worktree=`C:/tmp/impl-event-list-refine`。

## 実装（3コミット）
- **タスク1 #245**: pure ヘルパー＋テスト。`apps/web/src/app/(app)/events/event-list-utils.ts`（`formatEventDate` M/D(曜)ゼロ埋めなし・`formatDeadlineCountdown` 本日/soon(1-3)/normal(4+)/締切済/—・`isGradeEligible` 級のみ・`sortEvents` 締切/開催日・共有型 `EventListItem`/`SortAxis`/`DeadlineTone`・定数 `SOON_THRESHOLD`/`CHIP_LIMIT`）。`surname()` を詳細画面から `apps/web/src/lib/surname.ts` へ抽出（挙動不変・`[id]/page.tsx` は import 差し替え）。テスト30件。
- **タスク3 #247**: `EventListClient.tsx`（'use client'・区切り線リスト・並替セグメント既定=締切日順・申込可能スイッチ既定OFF・締切 tone→クラス(本日=朱accent-fg太字/soon=黒太字/normal=ink-2/締切済・—=ink-muted)・苗字チップ最大5＋他N名・空表示2種）。テスト13件。
- **タスク2 #246**: `page.tsx` を取得＋委譲に整理。参加者を `attend=true × users` innerJoin で表示中イベントぶん1クエリ（N+1回避）→級昇順（未設定末尾）→`attendCount`＋`chipSurnames`。`canApply=isGradeEligible(eligibleGrades, myGrade)`。h1「大会申込」。

## 非自明な決定
- **タスク実装順を逆転**（3→2）：page.tsx(タスク2) が `EventListClient`(タスク3) を import するため、各コミットが green になる順（component 先行→page 配線後行）。plan の「タスク3 は 2 に依存」は文書上の順序で、実コード依存は page→component。
- **参加数セマンティクス不変**：一覧の「参加 N名」は `attend=true` 全件（詳細画面の eligible 絞り込みとは別）。innerJoin は FK 保証で件数不変。
- **申込可能フィルタは管理者バイパスなし**＝管理者も自分の級で判定（詳細画面 `canRespond` は全許可バイパスするので流用不可・`isGradeEligible` を新規純関数化）。
- **全体0件の空表示はクライアントへ移譲**（`items.length===0`→「現在のイベントはありません」・コントロール非表示／フィルタ0件→「申込可能な大会はありません」）。
- **hydration mismatch 回避**：`todayStr`（JST）を prop 伝播・描画で `Date.now()` を呼ばない。
- **曜日算出**は `Date.UTC(y,m-1,d)` 構築で timezone 非依存・決定的。
- ①会場・⑤公認ピルは**一覧の表示削除のみ**（DB値・詳細表示は保持）。location/official/eligibleGrades/grade はカードへ渡さない。

## 検証
typecheck/lint/対象テスト43件 green。フル web suite は `new-member-form.test.tsx` が**フル実行時のみ**落ちる既知フレーク（単体では green・共有testDB の跨ぎ／`札幌次郎` 残行で create 衝突→form 未リセット・[[reference_worktree_vitest_db_setup]]／[[feedback_vitest_no_file_parallelism]]）＝本改修と無関係。CI は ephemeral DB で問題なし想定。

残=Codex レビュー→ship→本番実機目視。
