---
name: impl-roster-file-adoption-delta-wave12
description: roster-file-adoption 改修 Wave1-2
type: project
---

roster-file-adoption 2026-08-01 改修（親 #433）の Wave 1・2 を実装。worktree=C:/tmp/impl-roster-file-adoption / ブランチ feature/roster-file-adoption。

**タスク1（main 直・#434）**: `tournament_entry_roster_files.grades`（gradeEnum 配列・nullable）追加。**migration は 0053 ではなく 0054**（手順書の採番は誤り。0053 は payment_deadline_kind で既使用）。生成 SQL は `ADD COLUMN "grades" "grade"[]` の 1 行のみ＝純粋な追加で、NOT NULL/DEFAULT/backfill を含まないことをテストで固定（既存行 NULL＝グループ統一の解釈を守る）。enum array の ADD COLUMN はこのリポジトリ初。drizzle の array 列は `col.enumValues` が undefined で、`col.getSQLType()`（`'grade[]'`。引用符なし）と `col.baseColumn.enumValues` で検証する。

**Wave 2（task-implementer sonnet × 3 並行・#435/#436/#438）**: 変更領域の重複ゼロで統合問題なし。全て受け入れ確認済み（差分読み＋main が直列でテスト実行）。
- #435 roster-adopt-utils.ts（新規 leaf 純関数・23 テスト green）
- #436 adoptRosterFile を entryGroupId+grades へ。基本条件は**同一 event 行に対して 3 条件 AND**（別々の存在判定に分けると「団体戦だけ cutoff 内」のグループが通る穴）。isForeignKeyViolation(23503) を db-errors.ts へ追加。30 テスト green
- #438 大会詳細の級ラベル。events 配下 212 テスト green

**worktree のセットアップで踏んだ罠**: 前回出荷時の worktree ディレクトリ C:/tmp/impl-roster-file-adoption が **.git も apps/ も無い壊れた残骸**として残っており ensure-worktree.sh が fatal。さらに origin/feature/roster-file-adoption（PR #409 のブランチ・main へマージ済み）が残っていたため、スクリプトがその古い tip を追跡するブランチを作ってしまう。残骸を .stale-YYYYMMDD へ退避し `git branch -f feature/roster-file-adoption main` で張り直して解決した。

残タスク: #437（タスク4 = メール詳細の候補クエリ・採用シート UI・パースセクション削除）。
