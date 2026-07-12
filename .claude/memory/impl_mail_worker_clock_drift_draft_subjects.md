---
name: impl-mail-worker-clock-drift-draft-subjects
description: "mail-worker new_draft_subjectsのNode/DBクロックドリフト起因flakyを根治(bug-fix)。Issue#275/PR#276"
metadata:
  type: project
  category: bug-fix
  tags: [mail-worker, clock-drift, flaky-test]
---

# mail-worker: 新規大会案内の件名取得がNode/DBクロックドリフトで欠落する（Issue#275・PR#276）

worktree: `C:/tmp/fix-mail-worker-clock-drift-draft-subjects`（`fix/mail-worker-clock-drift-draft-subjects`）。要件定義書: `docs/bugs/275-mail-worker-clock-drift-draft-subjects/requirements.md`。

## 症状・深刻度

軽微（1ファイル本体+1テストファイルのみ、他機能影響なし）。`test/pipeline-runs.test.ts` の "happy path" / "new-drafts notification fires..." がローカル実行で確率的に失敗する既存flaky（[[impl_ai_dev_optimization]] で「未修正のバックログ」と記録されていたもの）。

## 根本原因

`apps/mail-worker/src/pipeline.ts` の `fetchNewDraftSubjects` が `gte(tournamentDrafts.createdAt, startedAt)` で **Node時計**（`startedAt = new Date()`）と **Postgres時計**（`tournament_drafts.created_at` の drizzle `defaultNow()`）を比較していた。両者は別クロックドメインで、WSL2 Docker環境（[[feedback_vitest_no_file_parallelism]]と同系統のドリフト）でDB側が遅れていると、挿入直後のドラフトが時刻範囲クエリから漏れ、LINE通知が「(件名取得に失敗)」になっていた。

**重要な訂正**: [[impl_ai_dev_optimization]] は当初「ファイル並列実行時のみ発生・`--no-file-parallelism`でpass」と誤診断していた。実際は `apps/mail-worker/vitest.config.ts` が元々 `fileParallelism: false` 済みで、単一ファイル単独実行でも約50%の頻度で再現した。並列実行はCPU負荷を上げてドリフトを増やす一因に過ぎず、根本原因ではなかった。CIでは通常ホストのクロックドリフトが小さいため滅多に顕在化しない。本番でもIMAP取得+AI呼び出しを挟むため `created_at` は `startedAt` から数秒〜数十秒後になり、実害はほぼ発生しない（テスト決定性・潜在的頑健性の問題として扱った）。

## 修正内容

時刻範囲によるバックフィル検索を廃止し、AIフェーズ（`runAiPhase`）内で新規に `pending_review` ドラフトが挿入された `mail_messages.id`（既に `rowId` として同フェーズ内で保持済み）を `PipelineSummary.newDraftMessageIds: number[]` として直接収集。`runOnce` はそのID集合で `mailMessages.id IN (...)` 検索して件名を取得する方式に変更し、クロックドメイン比較を完全排除した。

## 回帰テスト

`test/pipeline-runs.test.ts` に、`vi.useFakeTimers({toFake:['Date']}) + vi.setSystemTime` でNode時計をDB時計より5秒先行させ、決定的にドリフトを再現するテストを新規追加。修正前は決定的にfail・修正後は決定的にpassすることを確認済み。さらに既存2テストを通常実行で5回連続実行し、全てgreen確認済み（修正前は5回中3〜4回失敗）。

## Non-goals

`reextract.test.ts` の別の時刻境界flaky（未着手・別問題）、`persistOutcome` の `kind:'failed'` が `draftsInserted` にカウントされる既存仕様、リポジトリ全体の時計比較箇所監査（grepでこの1箇所のみと確認済み）。

## リンク

Issue #275 / PR #276 / commit 45a042e。ラウンド記録: [[auto_review_pr276]]
