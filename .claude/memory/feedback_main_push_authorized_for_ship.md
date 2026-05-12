---
name: kagetra_new で /ship が main に直接 push するのは事前承認済み
description: 1 人開発の身内プロジェクトのため、/ship Step 10 の worklog/memory 同期 commit を main に直接 push することは事前認可されている。確認なしで push してよい。
type: feedback
originSessionId: f79dc9e1-3f56-4f5c-8841-df6d9e50b75c
---
`kagetra_new` で `/ship` 実行末尾の worklog/memory 同期 commit を `main` に push するときは、**確認なしで `git push origin main` を実行してよい**。

**Why:** 1 人開発の身内プロジェクトで、PR 経由でない docs/memory コミットは元から main 直 commit ＆ push の運用（worklog 履歴を見ると過去すべてそのパターン）。毎回ユーザーに push を手動依頼するのはオペレーションのボトルネックになる、と 2026-05-12 にユーザーから明示的に要請があった（「毎回やるのはしんどいです」）。`/ship` Step 10 は CLAUDE.md ルール 6（セッションプロトコル）にも明記されている所定の動作。

**How to apply:**
- `/ship` Step 10（worklog 追記 → memory 同期 → commit → push）の **push 部分は確認なしで実行**
- `.claude/settings.json` に `Bash(git push origin main)` と `Bash(git push origin main:main)` を allow 済（2026-05-12 PR 経由でなく直接追加）
- ただし以下は **除外**（事前認可の範囲外）:
  - `git push --force origin main` などの破壊系
  - 実装コードの commit を main 直 push（必ず PR 経由）
  - 別のリポジトリでは適用しない（このプロジェクト限定）
- もし push が依然として deny される場合は、settings.json の allow が効いていないので調査が必要（hook / 別レイヤーのポリシー）
