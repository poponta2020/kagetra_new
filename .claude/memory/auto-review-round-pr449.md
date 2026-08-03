---
name: auto-review-round-pr449
description: auto-review PR #449
type: project
---

PR #449 (fix/line-attachment-flex-card) の Codex 自動レビュー記録。

- pr: 449
- round: R1 のみ（3-d initial 条件2 で打ち切り）
- phase: initial（全差分・網羅モード）
- model: gpt-5.6-sol / effort: high（差分 511 行 > 400 のサイズ起因）
- escalated: false
- verdict: needs_changes（blockers 0 / should_fix 1 / nits 0）
- 打ち切り: あり（should_fix 1 件が単一ファイル 3 行以内の局所指摘のため、再レビューラウンドを追加せず修正のみで終了）
- round_tokens: 215209 / cumulative_tokens: 215209（上限 500000）

## 指摘と対応

should_fix 1 件「altText の切り詰めが現行上限と Unicode 境界に一致しない」（line-flex-attachment.ts:90-92）は 2 つの主張が束ねられていたので分割して判断した。

1. **サロゲートペア分断 → 修正（de3f46a）**。slice(0, 400) は上限位置がサロゲートペアの途中に当たると単独サロゲートを末尾に残す。𠮟・𩸽 等の JIS 第3・第4水準漢字は人名・大会名で実使用されるため、コードポイント境界で止める truncateToUtf16Units を追加。境界跨ぎのテストも追加。
2. **上限 400 → 1500 の引き上げ → WONTFIX**。1500 という値を LINE 公式ドキュメントで確認できず（WebFetch 3 回は truncated、WebSearch は 400 と回答）、リスクが非対称。1500 が正なら 400 字超ファイル名の不要な切り詰めが起きるだけだが、400 が正で 1500 に上げると LINE API 400 で配信失敗になる。メール添付のファイル名が 400 字を超えることは実運用で発生しない。

## WONTFIX 一覧

- apps/web/src/lib/line-flex-attachment.ts — altText の切り詰めが現行上限と Unicode 境界に一致しない（上限引き上げ部分のみ） — 上限 1500 の主張を一次資料で確認できず、400 は両解釈で fail-safe

## レビュー対象外

- docs/spec/notifications.md（review-diff.sh の既定除外）
