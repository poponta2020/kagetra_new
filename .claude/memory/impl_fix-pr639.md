---
name: fix-pr639
description: fix PR #639
type: project
---

PR #639（fix/rename-app-to-hokumei）の Codex R1 指摘修正。

### 対応した指摘
- [CRITICAL] apps/mail-worker/src/classify/prompt.ts — プロンプト変更時に PROMPT_VERSION が更新されていない → 3.1.0→3.1.1（patch: 文言のみ）。履歴コメントに 3.1.1 エントリを追加。apps/mail-worker/test/classify/prompt.test.ts の describe・テスト名・期待値を 3.1.1 に追随

### 対応しなかった指摘
- なし（should_fix 0・nits 0）

### テスト
- test/classify/prompt.test.ts 26 テスト PASS（worktree・隔離DB kagetra_test_hokumei）
