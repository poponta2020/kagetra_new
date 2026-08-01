---
name: ship-roster-file-adoption-delta
description: 名簿ファイル採用: 級別採用・候補フィルタ・パース取込UIの退役
type: project
---

**PR #439 出荷完了**（マージ 2026-08-01・merge commit 9d026cf）。roster-file-adoption の 2026-08-01 改修。親 Issue #433 と子 #434-438 は全てクローズ済み。

## 出荷内容
- **級別採用**: `tournament_entry_roster_files.grades`（gradeEnum 配列・nullable / **migration 0054**。手順書の 0053 は既使用で採番ずれ）。NULL=グループ統一で既存行は無変換。複数級カバーは 1 行の配列＝`UNIQUE(source_attachment_id)` を維持。
- **採用対象をグループ単位へ**: `adoptRosterFile(attachmentId, entryGroupId, rosterType, grades, publishedAt?)`。基本条件（個人戦・非cancelled・cutoff以降）は**同一 event 行に対して AND**（分けると「団体戦だけ cutoff 内」のグループが通る穴）。級⊆グループ級集合を検証（cutoff は掛けない独立条件）、空配列は明示エラー、dedupe+A→E 正規化。`isForeignKeyViolation`(23503) を db-errors.ts に追加（deleteGroupIfEmpty との競合）。
- **候補提示規則**: 種別×取込単位の4象限で「申込済み ∧ その種別が未取込」を既定候補に。級別が一部だけのグループは全級カバーまで統一候補にも残す。「すべて表示」トグルで基本条件のみへ。**フィルタはサーバーで強制しない**（AC-17）。仕分けは client leaf 純関数 `roster-adopt-utils.ts`（DB 依存を型ごと import しない）、サーバーは平ら DTO のみ。
- **パース取込 UI の退役**（AC-20）: メール詳細の「大会名簿の取込」セクションを非表示。パーサ・Server Action・roster-drafts ページ・テーブル・既存テストは全温存（AC-21・直 URL で動く）。
- 大会詳細・メール詳細の採用済み表示に級ラベル（「D級」「A・B級」）。統一・既存データはラベルなし。

## Codex レビュー
3ラウンド（initial + delta + final）/ verdict=pass / effort=high→medium→high / 累計 502,823 トークン。
- R1 blocker（即修正）: 候補行から開催日が落ちて**同名の別 entry_group を識別できない**（旧 UI にはあった情報の後退）。候補行に開催日を表示して解決（774bf70）。
- R2 の同 title 再掲は**ユーザー判断で WONTFIX**: 「表示名も開催日も完全一致する別グループ」は同一大会の重複登録でしか起きず、誤採用しても「採用を解除」1クリックで回復できる（データ消失なし）。一覧性を落とす対価に見合わない。
- 再レビューせずに修正した指摘: なし（final が最終形を確認済み）。

## ★残 DoD
- **AC-23（本番実機）**: 実メールの名簿を新フローで採用し、候補の絞り込み・級ラベル・「すべて表示」トグルを確認する。対象が無ければ次に名簿が届いたときに実施。

## 運用上の学び
- `codex exec` の全差分レビュー（sol/high・2,800行）は **Bash の 10 分上限を超える**。R3 は SIGTERM で落ち、run_in_background で完走した。全差分×high は最初からバックグラウンド実行にする。
- ship-finalize の worktree 削除は Windows の長いパスで失敗し、`.git` だけ消えた**壊れた残骸ディレクトリ**が残る（今回も、前回 PR #409 の残骸も同じ状態だった）。この残骸は次回 ensure-worktree.sh を fatal にする。PowerShell の Remove-Item は MAX_PATH で失敗するが、**Git Bash の `rm -rf` なら消せる**。
