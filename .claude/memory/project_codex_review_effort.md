---
name: project_codex_review_effort
description: auto-review-loop の Codex reasoning effort は差分内容で auto 判定（PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 1736841e-1544-4478-b33c-0d2a1bf1b717
---

`/auto-review-loop` は Codex 呼び出しの reasoning effort を差分内容から **auto 判定**する（PR #69、2026-05-31 merge、merge commit 647aa62）。

- **ルーブリック**（`.claude/skills/auto-review-loop/SKILL.md` の 3-a.5）: 変更パスが auth/permission/middleware・LINE一斉配信(line×broadcast/notify/bot)・`apps/mail-worker/**`・schema/`drizzle`/`migrations`・P3課金(amadeus/agoda/rakuten/travel/payment) を含む、または規模大(diff>400行 or 変更>8ファイル) → **high**。それ以外（UI/CSS/docs/テスト等）→ **medium**。境界は安全側 high。
- **ラウンド内エスカレーション**: medium が blockers 検出 or ping-pong 膠着 → 残ラウンドを high に格上げ（一度だけ）。`xhigh` は手動 `--effort xhigh` のみ（auto では選ばない）。
- `codex exec` に `-c model_reasoning_effort=$ROUND_EFFORT` を明示指定。codex の `-c key=value` は値を TOML パースし、失敗時は生文字列扱いなので `medium`/`high`/`xhigh` の裸トークンでそのまま渡せる（`codex exec` に専用 `-e`/`--reasoning-effort` フラグは無い）。
- **`~/.codex/config.toml` の `model_reasoning_effort` は `high`→`medium` に変更済み（git 管理外の環境設定。次セッションで「なぜ medium か」を忘れないこと）**。理由: サブスク認証(`auth_mode=chatgpt`)はコスト=クォータ消費で、global 一律 high は全 Codex 利用(VS Code 拡張・他プロジェクト)を 3-5x 化するため。review はスキルが明示 effort を渡すので無影響、interactive のみ medium。
- **effort 段階と消費**（gpt-5.5）: `none<low<medium<high<xhigh`、既定 medium。コミュニティ実測で high≈medium 比 3-5x トークン、xhigh≈8-15x。境界の明確な「stdin diff→構造化JSON」レビューでは xhigh は過剰、low/none は浅すぎ。
- 注意: PR #69 自体のレビューは **旧スキル**(main 側)で回ったため effort=medium(global)。新ロジックが効くのは #69 マージ後の次回 /auto-review-loop から。
