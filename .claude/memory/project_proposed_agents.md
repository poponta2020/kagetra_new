---
name: project-proposed-agents
description: カスタムサブエージェント案7種の再評価。2026-07-01 に「7種一括作成」方針を撤回し「1種＋Skill/Hook振り分け」へ反転。2026-07-04 残る1種(code-reviewer-jp)も不採用が確定。
metadata: 
  node_type: memory
  type: project
  originSessionId: f0129448-e9a5-4291-9b98-8e18c7b09911
---

2026-07-01 初版でカスタムサブエージェント7種を提案 → **同日、公式ドキュメント・Anthropic公式ブログ・複数実務家記事（一次資料＋複数一致意見）を再調査して結論を反転**。詳細仕様＋旧案＋出典は `docs/dev/proposed-agents.md`（上書き済・旧案は末尾保存）。

**2026-07-04 追記**: code-reviewer-jp も不採用が確定（レビューは Codex/auto-review-loop で充足・Claude 使用量を割かないというユーザー判断）。代わりにモデル階層ワーカー `task-implementer`（Sonnet）を採用 → 正典と経緯は [[project_model_delegation]]。

**Why:** ゴールデンスタンダードは「a handful of well-scoped agents, not a sprawling roster」。solo で7種は乱立＝自動委譲を壊すアンチパターン。加えて①自動委譲(descriptionトリガー)は unreliable＝確実なのは @-mention/`--agent` の明示呼び出しのみ ②生成・ボイラープレートは公式が Skill と明言（生成物はメインに戻る＝隔離利点なし＋メインから文脈を隠す害）③目玉の「コスト1/15」はエージェント不要で無料回収可能。

**How to apply（再評価後の振り分け）:**
- **作るなら `code-reviewer-jp` 1つだけ先行**（唯一サブとして正しい形＝公式筆頭サンプルの客観レビュー。read-only・Codex前段の安価パス。効果測定してから増やす）
- **`test-scaffold`/`action-forge`/`hono-builder` は Skill 化**（生成はメイン文脈＝Skillが正解。hono は既存 nextjs-hono-engineer スキルが0回起動＝別エージェント作っても採用率上がらない）
- **`zod-syncer` は分解**: 乖離検知＝型テスト/lint、同期補助＝Skill
- **`migration-guard` は Hook or 明示実行 Skill**（安全ゲートを不安定な自動委譲に依存させない）
- **`drizzle-scout` は保留**: 内蔵 Explore(既定Haiku・読み取り専用)とほぼ重複。付加価値はスキーマ知識埋め込みのみ。「同じ調査を繰り返し手投げ」を実感したら初めて起票（公式起票基準）

**まずコスト問題を設定で潰す(無料・最優先)**: Explore-on-Opus25回は設定/バージョン起因の疑い。内蔵 Explore は本来 Haiku 既定で、旧版は `inherit` がサブをメインモデルに強制した(v2.1.196で解消)。Claude Code更新＋`CLAUDE_CODE_SUBAGENT_MODEL` を inherit 強制にしない だけで Explore は Haiku に戻り「1/15」の大半を回収 → `drizzle-scout` 要否を再判断。

**伸びしろ**: 未使用の Workflow で複数観点レビューを fan-out（実測9並列で actionable 75% vs 単体<50%）＝サブが数字で効くのはレビュー/調査の並列化であって生成の自動化ではない。既存の勝ちパターンは Skill チェーン(auto-review-loop/ship/prepare-pr)＝メイン文脈の自動化。

要旨=**「7つ作る」ではなく「1つ作って設定を直し、残りは Skill/Hook/テストへ振り分ける」**。[[feedback_no_scope_creep]] とも整合。
