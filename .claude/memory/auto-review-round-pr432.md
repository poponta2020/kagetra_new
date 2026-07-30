---
name: auto-review-round-pr432
description: auto-review PR #432
type: project
---

PR #432（級別参加費を画面と LINE 通知へ配線する / feature/grade-entry-fee）の Codex 自動レビュー記録。

## R1（phase=initial・全差分網羅）
- model=gpt-5.6-sol / effort=high（構造的高リスクパス: packages/shared/schema・drizzle。sol 較正の一段下げは高リスクパス起因なので適用せず維持）
- verdict=needs_changes / blockers=2 / should_fix=0 / nits=0
- round_tokens=444,442 / cumulative=444,442（上限 500,000）
- escalated=true（high で blockers 検出）
- 差分 8,700 行（うち約6,000行は drizzle の 0052_snapshot.json＝自動生成）

**blocker 1（修正した）**: 振込総額が支払方法の異なるイベントまで合算する。`setPaymentType` は1日単位で変更できるので同一申込グループ内で advance/onsite/NULL が混在しうる。事前払い 2,500円 + 現地払い 1,500円 で「振込総額 4,000円」と案内してしまい、支払締切リマインドは once-ever で訂正できない。→ `tallyEntryFeesForGroup` を `payment_type='advance'` に絞った（commit 3ff52bb）。**要件 §3.2.2 の「グループ全日の合算」を字面どおり実装したのが原因** — 「振込」総額なのだから振込に乗らない日は入らない、という含意が要件に書かれていなかった。

**blocker 2（WONTFIX・ユーザー判断）**: once-ever 通知の総額が claim 時点の参加者スナップショットに固定されない（コミットから集計クエリまでの数ミリ秒に出欠・級変更が重なるとずれる）。総額は本来動く量で翌日の出欠変更でも同じくずれるため、内訳併記で会計が引き算できる設計を維持。実装手順書の「集計を状態更新 tx に混ぜない」を覆す価値は低いと判断。以降のラウンドは WONTFIX として再掲禁止で渡す。

## R2（phase=delta・修正差分110行のみ）
- model=gpt-5.6-terra / effort=high（escalated=true かつ last_blockers=1 のため delta でも high）
- verdict=**pass** / blockers=0 / should_fix=0 / nits=0
- round_tokens=97,459 / cumulative=**541,901**（既定上限 500,000 を超過）
- 「修正起因の新規問題は確認できません」。WONTFIX にした claim スナップショットの指摘は再掲されなかった（再掲禁止の受け渡しが機能）

## ループの停止理由: token-budget
R1 の全差分 8,700 行のうち約6,000行が drizzle の 0052_snapshot.json（自動生成）で、これが 444k トークンの主因。R2 完了時点で累計が上限を超えたため、3-0 の事前チェックにより final（全差分の再確認）ラウンドを開始できない。

**判断材料**: R1 が gpt-5.6-sol/high で全差分を網羅レビュー済み。その後の変更は commit 3ff52bb（110行）だけで、これは R2 が確認して pass。final の追加価値は同じ 8,700 行を2度目に読むこと。最新の結果 JSON（r2）は verdict=pass で現 HEAD (3ff52bb) を指しているので gate-dod C1 は通る。

**教訓**: drizzle の migration を含む PR は snapshot JSON（数千行の自動生成）が全差分レビューのトークンを支配する。auto-review-loop の除外リストは docs/ と .claude/memory/ だけなので、migration 込みの PR では既定 500k を1〜2ラウンドで食い切る。
