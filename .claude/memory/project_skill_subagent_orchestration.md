---
name: project-skill-subagent-orchestration
description: 実装フローの骨格はスキルのまま維持し、葉ステップだけ context:fork でサブ委譲する設計方針（2026-07-01 公式一次資料で確定）。
metadata: 
  node_type: memory
  type: project
  originSessionId: 7dd0d71e-064b-421a-86c8-c31be2224fac
---

**Skills / Subagents / Workflows の使い分けを公式一次資料で確定（2026-07-01）。実装フロー全体の骨格はスキルのまま維持し、エージェント連鎖に置き換えない。**

**Why:** 「スキル連鎖を全部エージェント連鎖に置き換えられるのでは」という問いを再調査 → 公式判断基準は逆。
- 公式ブログ Steering Claude Code: *"Use a skill when you want the procedure to play out inside the main thread so you can see and steer each step"* / *"deploy workflows, release checklists, review processes belong in a skill"*。
- Subagents 公式ドキュメント: main会話を使うべき条件に *"Multiple phases share significant context, such as planning, implementation, and testing"* を明記。`define-feature→implement→prepare-pr→auto-review-loop→ship` は多段・文脈共有・side-effectあり＝全部スキル(main)側。
- サブは *fresh context で会話履歴を見ない* → 連鎖置換すると各ホップで蓄積文脈が切れる＝劣化。自動委譲も unreliable（[[project_proposed_agents]]）。

**How to apply（骨格維持・葉だけ委譲）:**
- **維持（スキル/main）**: define-feature / design-screen / make-plan / implement本体 / prepare-pr / ship。
- **サブ委譲する葉ステップ**: ①read-heavyな事前調査（スキーマ/既存コード）→ `context: fork` + `agent: Explore`（将来 drizzle-scout）で隔離、要約だけ返す ②客観レビュー→ `code-reviewer-jp` or `/code-review` を fork 委譲（Codex前段）。
- **公式機構**: スキル→サブは `context: fork`(+`agent:`) がフロント。逆方向はサブ frontmatter の `skills:` で知識先読み。⚠️`context: fork` はタスク自己完結スキル限定（履歴を見ないので implement 本体は fork 禁忌・公式警告）。
- **side-effect スキル**（ship/deploy）は `disable-model-invocation: true` 維持＝「Claudeが勝手に走らせない」公式パターン。
- **Workflows は規模もの専用**（過去データ一括移行・全コーパス監査・多観点並列レビュー）。1機能フローには過剰。現状 Workflow 0回だが札として温存。

**現状評価**: 今の「オーケストレーション＝スキル」運用は公式推奨アーキテクチャそのもので正しい。改善は置き換えでなく「調査＋レビューの葉を fork でサブに逃がす小改修」。まず1ステップで効果測定してから広げる。

正典ドキュメント= docs/dev/feature-flow.md「オーケストレーション設計方針」節。カスタムエージェント方針は [[project_proposed_agents]]。[[feedback_no_scope_creep]] とも整合。
