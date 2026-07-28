---
name: auto-review-round-pr400
description: auto-review PR #400
type: project
---

PR #400（ホーム「会の出場予定」/dashboard 全面置換）の auto-review-loop 記録。ブランチ feature/home-tournament-timeline・worktree C:/tmp/impl-home-tournament-timeline。**結果: PASS（3ラウンド構成 i+d+f）**

## R1 (phase=initial, model=gpt-5.6-sol, effort=medium)
- effort: ルーブリックは high（差分1821行>400）だが**サイズ起因なので sol 較正で medium へ**。高リスクパス起因ではない
- verdict=needs_changes / blockers=1 / should_fix=0 / nits=0 / round_tokens=177,966

**[BLOCKER] 回答権限のない未招待会員にも未回答アラートが表示される**（page.tsx:206-210）
Auth.js の signIn は LINE 連携済みの既存ユーザーを招待ゲート無しで通すため `is_invited=false` のログインセッションが実在する。その会員は `/events/[id]` の canRespond でフォーム無効・`submitAttendance` も throw するので、タップしても回答できないアラートが出ていた。
→ 修正 3ff2f63: 閲覧者取得に isInvited を追加し `viewerCanRespond = 管理者 || isInvited` をアラートのゲートに。回帰テスト2件追加（一般会員は出ない／admin・vice_admin は出る）

**★この指摘の意義（横展開したい教訓）**: 実装中に main と advisor の**両方が**「spec に無い条件は足さない（スコープ膨張回避）」と判断して isInvited ゲートを意図的に見送っていた。Codex は既存コードの canRespond / submitAttendance を根拠に「ユーザーに見える壊れ」として指摘した。**仕様の明文に無くても既存フローとの不整合は blocker になる** —— 「spec に書いていない＝足さない」は、既存画面と同じ操作を扱う機能では危険な省略になり得る

## R2 (phase=delta, model=gpt-5.6-terra, effort=high)
- effort: R1 が medium で blockers を出したため ESCALATED=true → high（差分は87行）
- verdict=pass / 0/0/0 / round_tokens=19,779

## R3 (phase=final, model=gpt-5.6-sol, effort=medium)
- effort: escalated だが LAST_BLOCKERS=0 でデエスカレーション（medium）
- verdict=pass / blockers=0 / should_fix=0 / **nits=1** / round_tokens=232,214

[INFO] HomeEntrant.userId の doc コメントが実挙動と矛盾（「同定漏れを落とさず nullable で持つ」と書いてあるが、確定パスは users への innerJoin で未同定行を除外している）
→ 修正 2999382: コメントのみ訂正（実行時挙動は不変）。3-d の nits-only 打ち切りで再レビューはせず、r4.json に verdict=cutoff を記録

## 累計
- 3ラウンド / Codex 累計 429,959 tokens（上限 500,000）
- **R3(final) だけで 232k** —— 全差分 medium の sol は R1(1821行) の 178k より高い。final は最終形を必ず見る網なので削らない方針だが、コスト内訳として記録
- 最終 HEAD = 2999382（r4.json の fixed_head と一致）
