---
name: auto-review-round-pr660
description: auto-review PR #660
type: project
---

pr: 660（invite-link-registration 名簿から選んで紐付け）
round: R1 / phase: initial（全差分・網羅モード）/ model: gpt-5.6-sol / effort: medium（差分 3,856 行 > 400 で high 相当→上限 medium に丸め）/ escalated: false
verdict: needs_changes（blockers 1 / should_fix 0 / nits 0）
round_tokens: 209,176 / cumulative_tokens: 209,176 / 500,000
指摘: [BLOCKER] apps/web/src/app/register/[token]/actions.ts:551-563 — 招待トークンの検証と紐付け更新の間に TOCTOU がある（claimViaInvite が招待の有効性確認と claimRosterMember の更新を別トランザクションで行うため、確認直後に revoke／ロック待ち中に期限切れだと紐付けが成立する）
WONTFIX（ユーザー判断で見送り 1 件）: apps/web/src/app/register/[token]/actions.ts — 招待トークンの検証と紐付け更新の間に TOCTOU がある — 数ミリ秒の窓で結果は取り消し直前の送信と同じ・権限の越境なし・既存 registerViaInvite も同じ作り（揃えるなら範囲外の既存処理も変える必要）
終了: 見送り後の修正対象 0 件 → initial の条件1で成功。final は省略（R1 が最終形を見ている）。修正コミットなし。gate-dod C1 用に r2.json を verdict=cutoff / reason=user-wontfix / fixed_head=c071e7a で記録
レビュー対象外（既定除外）: docs/features/INDEX.md・docs/features/invite-link-registration/implementation-plan.md・requirements.md・docs/spec/auth-admin.md・docs/spec/players.md
備考: Codex 側の Vitest は spawn EPERM で起動できず（型検査・ESLint は成功と報告）
