---
name: feedback-gh-issue-edit-empty-stdin
description: gh issue edit --body-file - の空 stdin は本文を全消しする
type: feedback
---

`gh issue edit <N> --body-file -` を**空の heredoc**で叩くと Issue 本文が丸ごと消える。`||` フォールバック付きのワンライナー（`gh issue edit ... <<EOF ... EOF` の本体を書き忘れた形）で実際に親 Issue #505 の本文を全消しした。

**Why:** `--body-file -` は stdin を読む。stdin が空なら「本文を空文字にする」という正常な編集として成功し、確認もされない。`gh issue view` で「読むだけ」のつもりの手が、書き込みコマンドとして成立してしまう。

**How to apply:**
- Issue/PR の**本文を読む**目的で `gh issue edit` / `gh pr edit` を使わない。読むのは `gh issue view <N> --json body -q .body` 一択。
- `--body-file -` に heredoc を渡すときは、本文を必ず先にファイルへ書いてから `--body-file <path>` で渡す（stdin を使わない）。
- 復旧手段: GitHub は編集履歴を保持している。
  `gh api graphql -f query='query { repository(owner:"OWNER", name:"REPO") { issue(number:N) { userContentEdits(first:10) { nodes { editedAt diff } } } } }'`
  の `diff` に**編集前の全文**が入っている（最新ノードの diff は null＝今回の編集、その次が直前の本文）。PR も `pullRequest(number:N)` で同じ。
