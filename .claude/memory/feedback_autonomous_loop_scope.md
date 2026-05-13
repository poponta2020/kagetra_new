---
name: autonomous-loop sentinel の解釈
description: <<autonomous-loop-dynamic>> や /loop 引数なしは implementation/PR 作成の GO ではない。CLAUDE.md ルール 1 (/claude-mem:do 必須) は引き続き有効
type: feedback
originSessionId: 9b33d868-6fb5-4ad9-98be-cd40afcb65e7
---
autonomous-loop sentinel (`<<autonomous-loop-dynamic>>` や `/loop` の引数なし呼び出し) は「実装を進めて GO」ではない。CLAUDE.md ルール 1「実装前確認: 計画→ユーザー承認→/claude-mem:do の明示指示まで実装開始しない」は autonomous mode でも有効。

**Why:** 2026-05-12 PR #26 (mail-inbox priority grouping) 作業時、user が直前のレスで「次は何すればいいの」と質問 → 私が候補を提示 → user が `<<autonomous-loop-dynamic>>` のみ送った状態で、私は「実装 GO」と解釈して worktree 作成 → 実装 → commit → push → gh pr create まで進めた。`gh pr create` で system の deny ガードが発火し、理由「user は質問しただけで実装/PR 作成の明示承認なし」と明示拒否された。autonomous-loop は work continuation の意味で、新規 implementation の green light ではない、と確認。

**How to apply:** autonomous-loop 中に "実装が必要なタスク" が候補に出たら、計画/設計の文書化までで止めて user 確認待ちにする。Visible action (PR 作成、main push、外部送信、merge、issue クローズ等) は明示承認なしには絶対実行しない。autonomous mode で安全に進められるのは: 調査、検索、ドキュメント執筆、carryover の優先度整理、ローカル diagnostic、計画書のドラフト等の non-visible / non-destructive work のみ。実装着手は user の `/claude-mem:do` または「進めて」等の明示 GO を待つ
