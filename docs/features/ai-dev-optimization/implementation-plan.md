---
status: completed
---
# AI開発最適化 — kagetra-new 適用（ブロックK）実装手順書

要件: [requirements.md](requirements.md)。親機能の全体像は match-tracker 側（出荷済み PR: poponta2020/match-tracker#1020）を参照。

## 実装タスク

### タスク1: 衛生タスク一式（CLAUDE.md修正・診断スクリプト移動・ネストCLAUDE.md・memory索引）
- [ ] 完了
- **目的:** CLAUDE.md の stale 修正（Lightsail→Oracle Cloud、apps/api スケルトン+BFF 注記）、apps/web/_*.mts を scripts/diagnostics/ へ移動+gitignore+再発防止ルール明記、apps/web/CLAUDE.md 新設（≤50行）、memory 索引差分解消
- **対応AC:** AC-K1, AC-K2, AC-K3, AC-K4
- **主な変更領域:** CLAUDE.md, .gitignore, scripts/diagnostics/（新規）, apps/web/CLAUDE.md（新規）, .claude/memory/MEMORY.md, .claude/project-profile.md §conventions
- **依存タスク:** なし
- **必要なテスト:** AC-K1〜K4 の grep/カウントによる機械確認（`ls apps/web/_*.mts 2>/dev/null | wc -l` = 0、`grep -c Lightsail CLAUDE.md` = 0 等）
- **完了条件:** AC-K1/K2/K3/K4 の機械確認がすべて pass
- **対応Issue:** poponta2020/match-tracker#1017（cross-repo・手動クローズ）

### タスク2: 全体仕様書フル作成 + features INDEX + profile レジストリ
- [ ] 完了
- **目的:** ドメイン区分け（requirements §5 の候補8ドメイン）を App Router 構造・28スラッグと突合して確定し、コードベースのリバースエンジニアリングで全体仕様書をドメイン分割形式でフル作成。INDEX.md と profile §docs レジストリも整備
- **対応AC:** AC-K5, AC-K6, AC-K7, AC-K8
- **主な変更領域:** docs/SPECIFICATION.md（新規ハブ≤200行）, docs/spec/（新規・各≤500行）, docs/design/db.md（packages/shared/src/schema/ の Drizzle 定義から生成）, docs/features/INDEX.md（新規）, .claude/project-profile.md §docs
- **依存タスク:** タスク1（同セッション先行推奨）
- **実装ガイド:**
  1. ドメイン区分けを確定（apps/web/src/app/ のルート構造と docs/features/ 28スラッグから）
  2. ドメインごとに task-implementer へ並列委譲（各エージェント: 該当ルート・lib・スキーマを読み、メタブロック（責務・関連ルート・主要実装パス）+ 機能仕様 + フロー + API(Server Actions/route handlers) の構成で起草。行番号参照禁止・連番見出し禁止・≤500行）
  3. db.md は Drizzle スキーマから機械的に生成（テーブル・カラム・制約・リレーション。500行超なら db-tables-*.md に分割）
  4. INDEX.md は match-tracker の docs/features/INDEX.md と同形式（末尾追記型・規約コメント付き。28スラッグ+ai-dev-optimization）
  5. profile §docs はレジストリ化（requirements §5 の devflow:docs ブロック込み）。§docs 更新後は gate-dod D2 が有効化される
- **必要なテスト:** 行数上限（ハブ≤200・ドメイン≤500）とスラッグ網羅の機械確認。主要3ドメイン（結果取込・イベント出欠・選手管理）のサンプル照合レビュー（AC-K6・ユーザーに提示）
- **完了条件:** AC-K5/K7 の機械確認 pass、AC-K6/K8 のレビュー完了
- **対応Issue:** poponta2020/match-tracker#1018（cross-repo・手動クローズ）

## 実装順序

1. タスク1（衛生）→ 2. タスク2（仕様書）
全タスク後: /prepare-pr → /auto-review-loop → /ship（PR は kagetra_new リポジトリ。PR 本文の Requirements: 行は本ファイルと同ディレクトリの requirements.md を指す）。マージ後に match-tracker #1017/#1018 と親 #1010 を手動クローズする。

## 注意（match-tracker ブロックRでの教訓）

- **この requirements.md / implementation-plan.md は未コミット**のため、/implement が作る worktree には存在しない。**タスク1の最初に docs/features/ai-dev-optimization/ を worktree へコピーして PR に含める**こと（コピー先はディレクトリ名まで明示。ブロックRで親ディレクトリへの誤コピー事故あり）。メインリポジトリ側の未コミットコピーは ship 前に削除する（ff-merge 阻害の既知パターン）

- 巨大 diff の Codex レビューはコンテキスト超過する → 判断が必要な差分+新規ハブ全文の縮約入力に切り替える
- 並列 task-implementer は同一 worktree 上で別ファイル担当なら競合しない
- python 一括置換で保護マーカー方式を使うと NUL 混入リスクあり
- worktree remove の「Permission denied」後に「is not a working tree」が出たら登録解除は成功している（残骸ディレクトリを rm -rf するだけでよい）
