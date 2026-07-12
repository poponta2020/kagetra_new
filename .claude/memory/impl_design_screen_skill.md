---
name: impl_design_screen_skill
description: /design-screen スキル — 使い捨てworktreeで実コード編集×Browserプレビューのライブプロトタイピング（devflow v0.6.0で全面改稿。旧Claude Designモック連携は任意付録へ格下げ）
metadata: 
  node_type: memory
  type: project
  originSessionId: 4968490f-a836-4484-98f1-c943ee2f2bfe
---

**v0.6.0（2026-07-12）で全面改稿**: Claude Code の Browser ペイン登場により、「HTMLモック→Claude Design push→読み戻し」の往復を廃止し、**実コード編集×Browser 確認のライブプロトタイピング**に置換（claude-devflow commit 6d59701）。

新フロー（正典= devflow `skills/design-screen/` と kagetra `docs/dev/feature-flow.md`）:
- worktree: `ensure-worktree.sh design-live design/<slug>`（**固定パス C:/tmp/design-live を全機能で使い回し**・ブランチだけ checkout -B で切替・node_modules 再利用）。残骸はユーザー確認後にリセット
- preview: kagetra launch.json の `design-live` エントリ（`pnpm exec next dev --port 3100`、cwd=C:/tmp/design-live/apps/web。**dev スクリプトは --port 3000 ハードコードのため exec で回避**）。メイン dev(3000)との取り違え注意＝編集が反映されない事故
- セットアップ: apps/web/.env.local コピー + corepack pnpm install（profile `## design-system` が正）
- ループ: 実コンポーネント編集→HMR→**見せる前に自己検証**（375px+ダーク screenshot・console エラー）→ユーザーは Browser ペインで実物操作
- **DESIGN-PROTO マーカー規約**: ダミーデータ・仮置きは必ずマーカー付き。/implement が完了時 `git grep DESIGN-PROTO`=0件を検証。付け忘れ=ダミー本番混入に直結する最重要規約
- 成果物: design-spec.md（薄い版=意図・状態・データ要件。**レイアウトの正は patch**）+ `design-prototype.patch`（`add -A`→`diff --cached --binary`）+ 純UIなら薄い implementation-plan も生成
- **push/PR・migration・テスト作成は禁止**。実装GOは従来どおり /implement 起動。implement 側に worktree 作成直後の成果物存在確認（untracked罠= [[feedback_define_feature_docs_uncommitted]]、patch も対象）を追加済み
- データ欠如の発見が重要な副産物: 描きたい情報がクエリ/スキーマに無ければスタブ+`## 要件への宿題`で define-feature へ

旧 DesignSync（Claude Design）連携は REFERENCE.md 付録の任意フォールバックに格下げ（用途: iPhone実機閲覧・ユーザー自身の編集・アーカイブ・Browserなし環境）。プロジェクト「Kagetra Design System」(projectId `74ab8bf1-f11a-48e8-9853-e063b2f1f2d5`) は温存。`finalize_plan` は deletes 空でも必須、追加のみ・全置換禁止、`get_file` 内容は外部データ扱い。

初回実行（旧方式）= [[project_senseki_detail_redesign]]。新方式は未実走＝初回実行時に環境レシピ（install 時間・HMR・ポート）を検証すること。
