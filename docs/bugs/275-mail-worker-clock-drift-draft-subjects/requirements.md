---
status: approved
issue: 275
---
# バグ改修要件: mail-worker 新規大会案内の件名取得がNode/DBクロックドリフトで欠落する

## 再現手順

1. `apps/mail-worker` で以下を5回程度繰り返し実行する:
   ```
   TEST_DATABASE_URL=postgresql://kagetra:kagetra_dev@127.0.0.1:5434/kagetra_test pnpm exec vitest run test/pipeline-runs.test.ts
   ```
2. ローカル DB（WSL2 Docker, `kagetra-db-test`）のクロックドリフトが十分あるタイミングだと、"happy path: inserts running row and updates to success with summary counters" または "new-drafts notification fires when drafts_created > 0" のいずれかが `new_draft_subjects` 関連のアサーションで失敗する（実測: 5回中3〜4回程度の頻度で再現）。`--no-file-parallelism` の有無やファイル並列実行の有無は再現率に関係しない（`apps/mail-worker/vitest.config.ts` は元々 `fileParallelism: false` 済みで、単一ファイル単独実行でも再現する）。

## 根本原因

`apps/mail-worker/src/pipeline.ts:621` の `runOnce` が `const startedAt = new Date()`（**Node.js 側の時計**）を記録し、`apps/mail-worker/src/pipeline.ts:1090-1116` の `fetchNewDraftSubjects` が `gte(tournamentDrafts.createdAt, startedAt)`（`tournament_drafts.created_at` は drizzle スキーマで `.defaultNow()` = **PostgreSQL 側の時計**、`packages/shared/src/schema/tournament-drafts.ts:75-77`）で新規ドラフトを絞り込んでいる。

Node プロセスと Postgres コンテナは別クロックドメインであり、WSL2 Docker 環境ではサブ秒〜秒単位のドリフトが生じ得る（既知: `.claude/memory/feedback_vitest_no_file_parallelism.md`）。DB側の時刻が Node 側よりわずかでも遅れていると、`created_at`（DB時刻）が `startedAt`（Node時刻）を下回り、`gte` 条件が偽になって、たった今挿入したはずのドラフトが取得漏れする。

grep 確認済み: `apps/mail-worker/src` 内でこのパターン（Node時刻とDB生成カラムの `gte` 比較）が存在するのはこの1箇所のみ。

## 修正方針

時刻範囲によるバックフィル検索（`fetchNewDraftSubjects`）を廃止し、AI フェーズの中で「新規に `pending_review` ドラフトが挿入された」`mail_messages.id` を直接収集する方式に変更する。クロックドメインの比較そのものをなくす。

- `PipelineSummary`（pipeline.ts）に `newDraftMessageIds: number[]` を追加、`emptySummary()` で `[]` 初期化
- `runAiPhase`（pipeline.ts:453-529）内、`persistOutcome` 呼び出し後に `outcome.kind === 'tournament' && tally.draftsInserted > 0` の場合、既に同関数内で保持している `rowId`（`mail_messages.id`。`tournamentDrafts.messageId` と同一）を `summary.newDraftMessageIds` に push する
- `runOnce`（pipeline.ts:614〜）で `fetchNewDraftSubjects(db, startedAt)` の呼び出しを、`summary.newDraftMessageIds` を直接 `mailMessages.id IN (...)` で引く新関数に置き換える（`gte`/`tournamentDrafts` の時刻比較・import は不要になった分を削除）

## Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | Node の時計を DB の時計より意図的に先行させた状態（`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime` で数秒先送り）で `runOnce` を実行しても、新規挿入されたドラフトの件名が `new_draft_subjects` と通知メッセージに含まれる | auto-test（決定的に再現する回帰テストを `test/pipeline-runs.test.ts` に新規追加。修正前は決定的に fail、修正後は決定的に pass することを確認する） |
| AC-2 | 既存テスト・lint・typecheck が全て成功する（デグレなし） | auto-test（`pnpm --filter @kagetra/mail-worker test` / `check-types` / `lint`） |
| AC-3 | 修正後、`test/pipeline-runs.test.ts` を通常実行（fake timer なし）で連続5回実行して全てグリーンになる（自然発生ドリフトによる偶発失敗が解消したことの確認） | manual（ローカルで5回反復実行し結果を記録） |

## Non-goals

- `reextract.test.ts` 等、他ファイルに存在しうる別の時刻境界 flaky（既知・別問題。トリップした場合も本PRでは追わない）
- `persistOutcome`（`classifier.ts`）で `kind:'failed'` のドラフト挿入も `draftsInserted` にカウントされる既存仕様の変更（新規ドラフト件数の集計ロジック自体は変えない）
- リポジトリ全体の「Node時計とDB時計を比較する箇所」の網羅監査（grep で本件1箇所のみと確認済み）
- 本番環境向けの追加対応。本番ではIMAP取得+AI呼び出しを挟むため `created_at` は `startedAt` から数秒〜数十秒以上後になり、本バグによる実害は現実的にはほぼ発生しない。テスト決定性・潜在的頑健性の問題として扱う

## 影響範囲

- `apps/mail-worker/src/pipeline.ts`: `PipelineSummary` 型・`emptySummary`・`runAiPhase`・`runOnce`・`fetchNewDraftSubjects`（`fetchDraftSubjectsByMessageIds` に置換）
- `apps/mail-worker/test/pipeline-runs.test.ts`: 回帰テスト追加
- DBスキーマ変更なし。mail-worker の「新規大会案内」LINE通知本文生成ロジックのみに閉じる。他ドメインへの影響なし

## 実施結果

- AC-1: 新規追加した回帰テスト（`vi.useFakeTimers({toFake:['Date']}) + vi.setSystemTime` でNode時計をDB時計より5秒先行させる）は修正前に決定的に fail（`new_draft_subjects` が空）、修正後に決定的に pass することを確認した
- AC-2: `pnpm --filter @kagetra/mail-worker test`（33ファイル・425テスト）/ `check-types` / `lint` すべて green
- AC-3: `test/pipeline-runs.test.ts` を通常実行で5回連続実行し、全てgreen（16/16）だった（修正前は5回中3〜4回が `new_draft_subjects` 関連で失敗していた）
