---
name: impl_design_screen_skill
description: /design-screen スキル — 任意画面の見た目を Claude Design(DesignSync)で見ながら作り込む汎用リデザインフロー
metadata: 
  node_type: memory
  type: project
  originSessionId: 4968490f-a836-4484-98f1-c943ee2f2bfe
---

`/design-screen <対象画面>` を新規作成（`.claude/skills/design-screen/` に SKILL.md＋REFERENCE.md＋design-spec-template.md）。型＝抽出(globals.css `@theme`＋`components/ui` プリミティブ)→ブリーフ→実トークンで HTML モック→Claude Design に push→見ながら調整ループ→確定したら `docs/features/<slug>/design-spec.md` に落として `/define-feature`・`/implement` へ委譲。**本番コードは書かない。** `disable-model-invocation:true`（外部 push の副作用）。新規スキルはスラッシュ起動が次セッションからなので、作成セッション中は手順を手動実行した。

非自明（DesignSync の使い方）:
- claude.ai/design 連携。既存プロジェクト「**Kagetra Design System**」(projectId `74ab8bf1-f11a-48e8-9853-e063b2f1f2d5`、ユーザー所有) の `preview/` に `@dsCard` マーカー付き HTML を**追加のみ**（全置換しない・`_card.css` は読むだけで再利用）。
- push 順: `list_projects`→`list_files`→`finalize_plan`(**writes/deletes 両方必須**・deletes 空でも渡す・`localDir` 指定)→`write_files`(`localPath`)→`register_assets`(保険)。`finalize_plan` が承認プロンプト＝外部公開のゲート。
- **pull-back**: ユーザーが claude.ai/design 側でモックを直接改良したら、こちらは `get_file` で読み戻す（コピペ不要）。ローカルを上書きし以降の編集が乗るように。新たに出た表示項目は実データで出せるか schema 確認してからハンドオフへ。
- ローカル作業 dir は `C:/tmp/...`（Windows の Write/Read は `C:/tmp` 参照。`/tmp` は git/pnpm 用で別物＝[[feedback_windows_worktree_path]]）。
- 初回実行＝[[project_senseki_detail_redesign]]。コミット/PR 化は未（main 作業ツリーに新規追加で作成）。
