---
name: project-devflow-v090-lean-review
description: devflow v0.8.0〜v0.9.0 レビュー軽量化の受け側適用（AC適合・追加code-review・/verify・マージ前CI待ちを標準ループから除外、pass即終了）。再装着条件あり
metadata:
  type: project
---

## 内容（2026-07-14）

match-tracker PR#1033 の実測（全114分中、AC適合13分・追加code-review12分・Codex確認専用ラウンドがすべて検出ゼロ、CI待ち約5分が純粋な待ち）を根拠に、ユーザーが「95%品質・短時間」方針でレビューパイプラインを軽量化。devflow v0.8.0（claude-devflow PR#2）+ v0.9.0（PR#3）としてリリース済み。プラグインは user スコープ導入のため本プロジェクトにも自動適用される。

- auto-review-loop: **pass で即終了**（nit は修正のみ・確認専用の再レビューなし）
- AC適合チェック（acceptance-reviewer）・大型差分の追加 /code-review・/implement 後の /verify: 標準ループから削除（手動起動は可）
- マージ前の CI 完了待ち: 廃止。`gh pr checks` は待ちなし1回判定、**失敗確定時のみ ship 中断**、pending はマージ可。gate-dod B1 も pending=PASS
- 本プロジェクト固有の注意: E2E は「CI が最終網」方針（profile ## commands）のため、v0.9.0 では **E2E の網はマージ後の main CI に移る**。main CI が赤なら自動デプロイは走らないので本番は守られるが、赤に気づいたら即 /quickfix・/bug-report で追修正すること

## 再装着条件（ユーザー合意「支障が出たら戻す」）

要件逸脱の出荷（→AC適合）／Codex見逃しの本番バグ（→追加code-review）／実動作不良（→/verify）／マージ後CI赤の頻発（→CI待ち）。詳細は match-tracker 側 .claude/memory/process_lean_review_pipeline_v080.md と devflow 各 SKILL.md の「v0.8.0/v0.9.0 で外した工程」注記。
