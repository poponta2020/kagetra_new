---
name: fix-pr543
description: fix PR #543
type: project
---

PR #543 (fix/542-line-linked-announcement) R1 指摘の修正。
- [CRITICAL] プローブ結果再利用で退出・revoke 競合に耐えない → ①フォールバック push は buildLinkedMessages(toMentionTarget([])) で③を素テキスト降格 ②送信直前に broadcast の status/lineGroupId/lineChannelId を再検証し、変化時は linked_announce_skipped ログのみで案内中止（要綱 push は自前再検証あり）
- [WARNING] 新設 fetch にタイムアウト無し → 在籍プローブ・defaultLineReplyClient・defaultLinePushClient に 30 秒 AbortController（line-broadcast-guidelines と同イディオム）
- WONTFIX なし。回帰テスト2件追加（フォールバック降格・revoke 競合）→ 45/45 green・tsc green。commit 2230812
