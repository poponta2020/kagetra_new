---
name: impl_tournament_results
description: "tournament-results 全5タスク SHIPPED。Task1 PR#163、Task2-5 PR#164。schema契約＋取込/承認/materialize/パーサの非自明な並行・整合性決定（Codex 5R）を記録"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5f746f13-4694-475e-b839-6895cab21053
---

tournament-results（全国大会結果取込）**全5タスク完了・本番マージ済**。要件/計画は [[project_tournament_results_def]]。

## 進捗（完了）
- **Task1 (#158) schema+migration: PR #163 merge `f3d2b4b`**、migration `0026_third_charles_xavier.sql`、本番適用済。
- **Task2-5 (#159-162): PR #164 merge `8e3ad35`（2026-06-20）**。1 ブランチ `feature/tournament-results-parser` に Task2-5 をまとめて 1 PR（worktree モデル＝/implement の連鎖で Task2 が先行 session で同ブランチに乗っていたため。要件§8 の「5 PR 分割」からは逸脱だが 1 機能 1 PR として許容）。親#157＋子#158-162 全クローズ。
- **Codex auto-review-loop 5 ラウンド（全 effort=high）で pass**：R1 3 blockers/R2 1 blocker+1sf/R3 0b+2sf/R4 0b→2 blockers+1sf(parser 初深掘り)/R5 **pass**。累計 ~790k tokens（既定 500k cap は超過、ユーザー承認の上で確認レビュー継続）。CI green。

## 取込→確定の並行・整合性決定（Codex 5R で確定。Task4+ の materialize/actions が依存）
- **worker (runResultParse) と Server Action (triggerResultParse) の draft 状態ポリシーは一致必須**：approved/pending_review は**上書き禁止（skip）**、parse_failed/rejected/superseded は**再取込可（上書き）**、無→insert。worker の UPDATE は `where(and(eq(id), inArray(status, OVERWRITABLE)))` で**status ガード**＝stale/racing job の clobber を防ぐ。catch fallback も同ポリシー＋`extractedPayload` を `{}` リセット（R1/R3/R4）。
- **approveResultDraft は tx 内 `SELECT ... FOR UPDATE` で draft 行をロック→状態再確認→materialize**＝check-then-act 競合で大会重複生成を防ぐ（R2）。
- **rejectResultDraft も status ガード付き原子 UPDATE + returning 件数判定**＝reject が approve と競合して承認済みを rejected に戻すのを防ぐ（R2）。
- **materialize の participant id は配列 index で保持（名前キー禁止）**＝同一級の同姓同名が自分の試合を奪う破損を防ぐ（R1）。**opponent 解決は `normalizePlayerName` 正規化キー**で、級内一意のときだけ張る（曖昧/未知→null、opponent_name は raw 保持）（R3）。
- **player get-or-create**：`(normalized_name, affiliation)` で lookup、**affiliation も正規化して lookup と保存を一致**（R1 should_fix。raw は participant スナップショットに残す）。INSERT は **`onConflictDoNothing()`（target 列指定なし）+ 再 SELECT**＝NULLS NOT DISTINCT 制約を確実に解決、別 draft 同時承認の UNIQUE 違反を回避（R2/R4）。
- **パーサ parseResultExcel は同一 className を Set で捨てず participants を MERGE**＝級が複数シート分割でも結果欠落させない（R4 blocker・データ破損）。**detectSignatureRow の scoreCol/resultCol 探索は round ブロック内（次の相手列手前まで）に限定**＝`相手/枚数/備考/勝敗` の 4 列レイアウトで 備考 を勝敗と誤読しない（R4 should_fix）。

## schema 契約（Task1 確定・前掲を維持）
- players UNIQUE は `NULLS NOT DISTINCT`／matches (participant_id, class_id) composite FK で級整合・opponent は不可（材料化で同一級のみ解決）／result_drafts message_id UNIQUE=1メール1ドラフト／循環・自己 FK は raw ALTER／**テスト DB は push 構築で composite FK 取りこぼし→CI fresh は無問題**。
- **gotcha: `db:push` は NULLS NOT DISTINCT 制約を毎回 drop→再追加（global-setup ログに出る）が機能影響なし**。
- mail-worker は `./result-import/schema` と `./result-import/normalize` を export し web (materialize/queries) が再利用。

## 閲覧（Task5）
- `/players` 検索＋`/players/[id]` 戦績。BottomNav に **`戦績` タブ（会員でも見える初の共有タブ）**。勝敗集計は `matches` の **`status='normal'` のみ**（不戦勝/棄権除外）＝SQL FILTER で導出。

## 残 DoD
- 本番反映（auto-deploy が `8e3ad35` で WEB+mail-worker ビルド→migration 冪等→restart）後の**実機通し**：結果 Excel 取込→レビュー→承認→`/players` で戦績表示、iPhone 実機で戦績/レビュー画面表示。**migration は 0026 のみで Task2-5 は新規 migration なし**。
- [[feedback_drizzle_kit_push_prompt]] [[feedback_ship_dod_residual_check]] [[feedback_admin_delete_for_update_race]]

関連: [[project_tournament_results_def]] [[reference_legacy_dump]] [[feedback_gh_pr_merge_from_worktree]] [[feedback_vitest_no_file_parallelism]]
