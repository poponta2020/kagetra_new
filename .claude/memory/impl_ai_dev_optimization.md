---
name: impl-ai-dev-optimization
description: AI開発最適化ブロックK実装 — 衛生タスク(CLAUDE.md stale修正/診断スクリプト移動/apps/web CLAUDE.md/memory索引)+全体仕様書フル新規作成(9ドメイン+db.md+INDEX+profileレジストリ)
metadata:
  type: project
---

# ai-dev-optimization（ブロックK）実装記録

worktree: C:/tmp/impl-ai-dev-optimization（feature/ai-dev-optimization）。対応Issue: match-tracker#1017/#1018（cross-repo・closing keyword不可・マージ後手動クローズ、親#1010も）。

## タスク1: 衛生タスク一式（コミット 525ac17）

- K1: CLAUDE.md の Lightsail→Oracle Cloud（東京/new.hokudaicarta.com）置換、構成ブロックに apps/api スケルトン（src 3ファイル）+BFF注記+apps/mail-worker 行を追加。後続で「LINE通知(1チャネル1人×80)」も実装（Botプール30個・大会単位）に合わせ修正
- K2: apps/web/_* 診断スクリプトを scripts/diagnostics/ へ移動+gitignore+生成先ルール明記（CLAUDE.md/profile §conventions）
- **発見: .gitignore 末尾バグ** — `.credentials.local.md` と `.claude/.devflow-state` が改行なし連結で両方 ignore されていなかった（資格情報コミットリスク）。同コミットで修正
- **発見: 移動対象115本のうち8本は tracked だった**（d7a3705「Tier2引き継ぎ用」: _rehearse_load/_probe/_reresolve 等）。未追跡前提の物理 mv では PR が8ファイル削除になるため、main 側は git restore で復元し、worktree で **git mv**（tracked のまま scripts/diagnostics/ へ。gitignore は tracked に無効なので履歴・2環境同期が保たれる）。apps/mail-worker/_extract_docs.mts も同カテゴリで git mv
- K3: apps/web/CLAUDE.md 新設（28行）。**パーサ本体は apps/mail-worker/src/result-import/**（web の lib/result-import は materialize のみ）
- K4: .claude/memory/ 実130 vs 索引113 → 16件追記で差分0

## タスク2: 全体仕様書（9ドメイン+db.md 5ファイル）

- 候補8ドメインに **ui-shell を追加して9ドメイン**（sticky-mobile-shell/pwa-minimal/settings-sheet の受け皿）。task-implementer 9+db 1 を並列委譲、ハブ/INDEX（29スラッグ）/profile §docs レジストリ（devflow:docs マーカー）は main 作成
- 行数: ハブ56 / spec 71〜210 / db系 134〜219（全て≤500。schedule 71・ui-shell 95 は §5 下限100を実態優先で下回る）
- **AC-K6 事前検証**: 独立 Explore(sonnet) 3体で主要3ドメインを敵対的照合 → 捏造ゼロ・軽微修正3件のみ（events-archive 表示項目 / players 直近1件の過度な一般化 / parseResultHtml 呼び出し元）を反映済み
- 境界裁定: result_drafts 承認画面は /admin/mail-inbox/result-drafts/[id]（tournaments-results 正典・mail-worker はリンク）/ lib/stats/series.ts・results.ts は集計契約=stats・画面=tournaments-results / invite-code.ts は会員招待でなく LINE Bot 6桁確認コード（notifications 正典）
- **発見: mail-worker テスト2件は main でも full suite 実行で落ちる既存 flaky**（pipeline-runs.test.ts、単一ファイル+--no-file-parallelism では pass。パッケージ test script が素の `vitest run` でファイル並列の共有DB干渉）。本PRとは無関係・未修正（スコープ外）

## 出荷（2026-07-12）

- PR #274 https://github.com/poponta2020/kagetra_new/pull/274 → **MERGED**（マージコミット 24064d5）
- レビュー: Codex 3R(pass)・AC適合pass・追加/code-review high(修正5類・残0)。詳細=auto_review_pr274.md
- Issue: match-tracker #1017/#1018/#1010（親）すべて手動クローズ済み → **AI開発最適化 3リポジトリ横断機能は全ブロック完了**
- 残置: メインリポジトリの scripts/diagnostics/ に未追跡106本（gitignore対象・意図どおり）。mail-workerテストのファイル並列flaky（pipeline-runs.test.ts 2件）は未修正のバックログ
