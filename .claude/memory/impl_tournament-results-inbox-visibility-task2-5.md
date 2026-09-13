---
name: impl-tournament-results-inbox-visibility-task2-5
description: tournament-results 受信箱可視性 タスク2-5
type: project
---

tournament-results 2026-09-13 改修のタスク2-5（Wave 2 = タスク2/3/4 並行・Wave 3 = タスク5 docs）。ブランチ `feature/tournament-results` / worktree `C:/tmp/impl-tournament-results`。

**Wave 構成と委譲**: タスク2（一覧）/ タスク3（件数4経路）/ タスク4（対応不要ガード）を task-implementer 3体で同時実装。変更領域の宣言どおり衝突ゼロ（排他宣言ミスなし）。タスク1・5は main 直。3体とも `worker_verify: none` を守りテスト未実行で返し、バリア後に main が直列実行した。

**★踏んだ罠: 同一テストファイルに describe を足すと既存 describe の `afterAll(closeTestDb)` が pool を閉じ、後続 describe の `truncateAll()` が全滅する**。page.test.tsx の新規8ケースが全て「Failed query: TRUNCATE TABLE ...」で落ちた（単体 `-t` 指定だと1件だけ走るので通ってしまい、原因が見えにくい）。修正 = describe ごとの `afterAll(closeTestDb)` を廃し、**ファイル末尾に1つだけ**置く。今後この repo で DB テストファイルに describe を追加するときは最初からこの形にする。

**実装の要点**:
- 一覧の除外は `.filter()` でなく **WHERE 句**（`notInArray`・空配列時は句ごと落とす）。後段 filter だと隠す行が `ACTIVE_LIMIT=100` の枠を食う
- 状態ピルの判定順は **「滞留 → ドラフト状態」**。`loadStalledResultImportMailIds` が AC-39 の除外を済ませているので、この順なら「古い parse_failed ドラフトを抱えたまま再取込が詰まっている」ケースを取込失敗でなく滞留として出せる。逆順だと滞留に気づけない
- 「対応不要」は一覧・詳細・`dismissMail` の3箇所すべてが `resultImportBlocksDismiss` を通る。詳細画面は `FOR UPDATE` を張らない `hasInFlightResultImportJob` を使う（描画から行ロックしない）
- 滞留（30分超）だけのメールは dismiss を**塞がない** — 警告付きで一覧に出ており、worker 停止時に管理者が片付けられる必要があるため。一覧の表示条件も同じ結論になる

**検証結果（main が直列実行）**: web 型検査クリーン / mail-worker 型検査クリーン / shared 型検査クリーン / page.test.tsx 20 / actions.test.ts + mail[id]/page.test.tsx 222 / result-import-visibility 29 / mail-history 3ファイル 36（AC-30 回帰）/ mail-worker web-push 9 / eslint 全変更ファイル 0件。

**既存の乖離（今回の変更が生むものではない・触っていない）**: 一覧見出しの「未処理 (N)」は描画行数（`ACTIVE_LIMIT=100` 上限）、バッジ API は真の `COUNT(*)`。100件超では改修前から数字が食い違う。

**★スコープ外として残した穴（別 Issue 候補・今回の変更が作ったものではない）**: メール詳細の統合処理フォームの表示条件は `showProcessForm = !mail.draft && triageStatus === 'unprocessed'` のままなので、`pending_review` の**結果**ドラフトを持つメールでもフォームは出る。「対応不要」ボタンだけは塞いだが、`processMail`（種別＋紐付けの実行）経由なら依然として processed にできる。`tournament_drafts` の場合はフォームごと出ないので非対称。要件 §3.6・AC-29 は `dismissMail` しか名指ししておらず、改修前から到達可能だったため今回は直していない。
