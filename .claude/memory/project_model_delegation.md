---
name: project-model-delegation
description: モデル階層委譲の仕組み（2026-07-04導入）。main=Fable/Opus固定・調査=Explore(haiku明示)・仕様確定実装=task-implementer(sonnet)・レビューはCodex一本(Sonnet前段レビュー不採用)。正典=docs/dev/model-delegation.md
metadata: 
  node_type: memory
  type: project
  originSessionId: dae52fdf-2875-483d-9569-8d58249d275f
---

**モデル階層委譲を導入（2026-07-04）。** 開発フローの骨格（スキル）は変えず、葉ステップに下位モデルを割り当てた。正典= `docs/dev/model-delegation.md`。

**構成:**
- **main（Fable/Opus）**: 要件定義・設計判断・計画・曖昧なデバッグ・跨層リファクタ・schema/migration・認証認可・委譲結果の受け入れ確認・コミット/ship・本番操作。mainのモデルは切り替えない（キャッシュはモデル別）
- **Sonnet（`.claude/agents/task-implementer.md`, effort: high固定）**: 実装手順書で完全仕様化された単一タスクの実装。委譲4条件（仕様完全・設計判断なし・検証手段あり・高リスク領域なし）をすべて満たす場合のみ。仕様は要約せず全文添付・commitしない・迷ったら停止して報告→mainが引き取る（再委譲リトライ禁止）
- **Haiku（内蔵 `Explore` に `model: haiku` を**毎回明示**）**: read-heavyな探索・関連ファイル特定・既存パターン収集。⚠️ v2.1.198+ の内蔵Exploreは main継承（Opus上限）なので指定なしだと高額

**Why:** Fable/Opusは方針決め・裁定に集中させ、指示どおりの実装にはオーバースペック（Sonnet=1/3〜1/5、Haiku=1/10価格）。Web調査で「well-specified planならSonnet実行で品質維持」「曖昧タスクの丸投げ・executorのeffort不足・静かな能力ミスマッチが3大失敗」と確認し、対策（全文仕様・effort high固定・main受け入れ確認+CI+Codex後段網）を規約化。

**How to apply:**
- 配線済み: implement Step7（存在しなかった nextjs-hono-engineer 等の参照を委譲判定に差替）／do-plan Step4（claude-mem:do への指示文に【モデル委譲】ブロック）／quickfix Step1・Step6（test-automator/security-auditor の幽霊参照も撤去）／define-feature Step2／feature-flow.md「モデル階層」節／CLAUDE.md 技術スタック1行
- 運用ルール（2026-07-04 監査で追加）: 小径修正は委譲しない・ワーカー並列は worktree 分離・スカウト要約は地図（核心ファイルは main 自読）・テスト要件は brief に必須・受け入れNG2回で委譲除外＋正典更新・claude-mem にワーカー種別を記録。task-implementer には UI 既知バグ規約と「DB書き込みはテストDB限定」を埋め込み済み
- **code-reviewer-jp は不採用が確定**（ユーザー判断: レビューはCodexで充足・Claude使用量を割かない・Sonnetレビュー効果に疑義）。レビュー系の提案を蒸し返さない
- 価格（2026-07-04）: Fable $10/$50・Opus $5/$25・Sonnet 5 $3/$15（〜08-31イントロ$2/$10）・Haiku $1/$5 /MTok

関連: [[project_skill_subagent_orchestration]]（骨格はスキル維持）、[[project_proposed_agents]]（7種撤回の経緯）、[[feedback_no_scope_creep]]
