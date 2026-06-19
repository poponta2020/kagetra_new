---
name: impl_tournament_results
description: "tournament-results 実装進捗。Task1(schema+migration 0026) SHIPPED PR#163。Task2-5 未着手。schema 契約の非自明な決定を記録"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5f746f13-4694-475e-b839-6895cab21053
---

tournament-results（全国大会結果取込）の実装進捗。要件/計画は [[project_tournament_results_def]]。5 PR 分割（要件§8・「1PR=1タスク」）で進める＝1 タスクずつ別 worktree/PR。

## 進捗
- **Task1 (#158) shared schema + migration: SHIPPED**。PR #163 merge `f3d2b4b`（2026-06-20）、#158 クローズ・親#157 チェック更新。Codex auto-review-loop 3R で pass（effort=high 固定、累計 184k tokens）。migration は **`0026_third_charles_xavier.sql`**（composite FK 反映で再生成）。worktree 削除済。
- Task2 (#159 パーサ中核・最難) / Task3 (#160 ジョブ+ボタン) / Task4 (#161 レビュー+確定保存) / Task5 (#162 戦績ページ) は未着手。**次は Task2**。

## Task1 で確定した schema 契約（Task2-5 が依存する非自明点）
- **players UNIQUE(normalized_name, affiliation) は `NULLS NOT DISTINCT`**。所属 null 選手が多数のため既定の NULLS DISTINCT だと Task4 の get-or-create（ON CONFLICT(normalized_name, affiliation)）が重複行を作る。所属不明=名前のみが同定キー。
- **matches の (participant_id, class_id) は composite FK → tournament_participants(id, class_id)**（`tournament_participants_id_class_id_uq` がターゲット）。「試合の級＝参加者の所属級」を DB 保証し、冗長 class_id を級別集計で信頼できる（Codex R1 should_fix）。**opponent は composite 不可**（ON DELETE SET NULL が NOT NULL の class_id を co-null できず削除失敗）→ opponent の同一級は **materialize 時に同一級 participant のみ解決**して担保（opponent_name が正の soft 参照）。
- **result_drafts は message_id UNIQUE = 1 メール 1 ドラフト（§4.1、ユーザー確認済 2026-06-20）**。複数 Excel 添付は「対象選択」で 1 つ取込、`result_parse` payload の attachment_id はパース対象指定（添付別ドラフトは作らない）、再取込は supersede。添付別ドラフト/複数大会同梱メールの個別取込・マージは後続（Codex R2 で指摘されたが §4.1 維持を選択）。
- 循環 FK (tournaments.source_result_draft_id ↔ result_drafts.tournament_id) と自己 FK (result_drafts.superseded_by_draft_id) は drizzle schema 上 plain integer、FK は migration の raw ALTER で付与（tournament_drafts 踏襲。正準は result_drafts.tournament_id 側）。
- **gotcha: テスト DB は `drizzle-kit push --force`（global-setup）構築。push は単独→composite FK の変更を取りこぼす**（実害: ローカル test DB が stale 化して composite FK テストが落ちた→ kagetra_test を drop+再作成で解決）。**CI は毎回 fresh test DB なので影響なし**。raw-ALTER FK 2 本も push には出ない（prod の `db:migrate` のみ）。Task4 の materialize テストは push に出る `.references()`/composite FK のみ当てにする。
- participants は生スナップショット層：dan / member_no / final_rank は **text**（ロスレス）。勝敗数は持たず matches の `status='normal'` のみ集計で導出。
- `mail_worker_job_kind` に `result_parse` 追加済。`apps/mail-worker/src/jobs.ts` の `MailWorkerJobKind` も同期済だが **runtime の claim/dispatch 配線とハンドラは Task3**（enum 値は存在するが Task3 まで実行時に生成されない＝安全）。

## 残 DoD
- **なし**。本番 migration 0026 適用済（PR #163 deploy run `DEPLOY_RESULT=SUCCESS`・`APPLY: 0026_third_charles_xavier`・`migrations applied`、2026-06-20）。新規テーブルは UI 無しのため実機目視不要。次は Task2 (#159 パーサ中核)。[[feedback_drizzle_kit_push_prompt]] [[feedback_ship_dod_residual_check]]

関連: [[project_tournament_results_def]] [[reference_legacy_dump]] [[feedback_gh_pr_merge_from_worktree]] [[feedback_nextjs_module_state_globalthis_pin]]
