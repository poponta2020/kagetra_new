---
name: impl-mail-ai-regional-eligibility-task5
description: mail-ai-extract-refinements 地域制限判定 タスク5（docs）
type: project
---

mail-ai-extract-refinements 改修（D・E 級の地域制限判定・親#612）タスク5（#617）: docs/spec/mail-worker.md を in-place 更新（「AI 抽出」節: classifyMail 手順6に照合を追記・ExtractionPayloadSchema 段落の直後に 3.1.0 の regional_eligibility／判定規則／根拠の機械照合／evidence_verified の tool schema 除去／events へ持ち回さない旨の2段落。「ドラフト承認詳細」節: 承認フォームの初期値と警告の規則＋ExtractedPayloadView の小表の2段落）。docs/features/INDEX.md は define-feature 時点で 2026-09-08 改修の一文が既に入っていたため変更なし（[shipped] は /ship が付ける）。main 直・全5タスク完了。次= /prepare-pr feature/mail-ai-extract-refinements。
