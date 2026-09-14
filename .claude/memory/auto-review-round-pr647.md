---
name: auto-review-round-pr647
description: auto-review PR #647
type: project
---

PR #647（event-line-broadcast ③人数内訳）のレビューループ。

- pr: 647 / round: R1 のみ / phase: initial（全差分網羅）
- model: gpt-5.6-sol / effort: medium（差分1320行>400 → 元判定 high を上限 medium へ丸め）/ escalated: false
- verdict: needs_changes（blockers 2・should_fix 0・nits 0）→ **ユーザー判断で2件とも見送り（WONTFIX）→ cutoff(user-wontfix) で終了**
- round_tokens / cumulative_tokens: 300,905 / 300,905（上限 500,000）
- 結果JSON: scripts/review/output/codex-result-pr647-r1.json（Codex原本）/ -r2.json（cutoff記録・fixed_head=reviewed_head=adf87a8）
- レビュー対象外（既定除外）: docs/ 配下6ファイル

## 見送った指摘（WONTFIX）
1. entry-headcount.ts — 役割フラグが付いたゲストが人数へ計上される
   → ゲストに会計フラグを立てない運用で回避。★調査で判明: 副連絡責任者は Server Action 側に既存ガード（『ゲストには副連絡責任者を付与できません』actions.ts:764）があり到達不能。会計にはガードが無く UI 上は可能だが、既存の @会計 メンション（loadTreasurerLineUserIds）も同様にゲストを除外していないので挙動は一貫している
2. entry-headcount-breakdown.ts — 役割者名の列挙が LINE の5000文字上限を超える
   → 到達には役割保持者が1000人規模で必要（名字2〜4文字）。会員100名では起こり得ない。分割送信は reply 5通制限と絡んで送信経路が複雑化し、名前の打ち切りは要件§3.1.3a（複数該当は全員を中黒で並べる）の変更になる

## Codex の good_points
- DB からの事実収集と排他計算の分離（DB なしで分岐を検証できる）
- 合計を出力行の和ではなくテスト側で独立に構築した集合と比較している点

## 注意
Codex は対象テストの実行を試みて esbuild の spawn EPERM で失敗している（サンドボックス制約）。テストは main 側で実行済み（5ファイル137件 green）。
