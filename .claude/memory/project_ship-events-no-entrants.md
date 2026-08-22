---
name: ship-events-no-entrants
description: 「大会」への呼称統一と「申込者なしで締切済の大会」ページ新設
type: project
---

PR #512 出荷（2026-08-22 マージ・https://github.com/poponta2020/kagetra_new/pull/512 ）。親 Issue #505 / 子 #506・#507・#508 すべてクローズ。

## 出荷内容
1. **「イベント」→「大会」の呼称統一**: ボトムナビ タブ2、`/events-archive` の h1・戻りリンク・0件文言、`/events` フッターの archive リンク、`EventListClient` の 0件文言。href・active 判定・タブ数・URL パスは不変（Non-goals: 作成/編集画面・管理系画面の文言は据え置き）。
2. **`/events-no-entrants` 新設**: 開催日前 × 会内締切超過 × `attend=true` が0名 × `entry_status<>not_applying` の大会を開催日昇順で並べる。掲載対象は閲覧者によらず同一。カード右は「参加 n名」でなく `会内締切 M/D`。ゲストは `isGuestAllowedPath` へ**追加しないこと自体が仕様**（fail-closed で middleware が /403）。
3. **`/events` フッター2段化**で導線追加（ゲストには非描画）。

## 設計上の確定事項（レビューで争点になった）
- 締切超過は **2 段構え**: SQL は境界セマンティクスを持たない前段フィルタ（`internal_deadline IS NOT NULL AND < today`）、掲載可否の確定は `isPastDeadline` のみ。Codex R1 が「二重定義」と指摘したが**ユーザー判断で前段フィルタを残す方針を確定**し、要件定義書 §6 の文言（元は「SQL に締切比較を書き写さない」）を実装に合わせて訂正した（コミット 1a5b138）。★前段が `isPastDeadline` より広いか等しいことに依存するので、境界を変えるときは前段も必ず併せて見直す。
- **承認済みの requirements.md と implementation-plan.md が矛盾していた**（§6 は SQL 禁止・手順書は SQL 前段）。実装は手順書に従っていた。define-feature 側で両文書の技術的制約を突き合わせる工程が無い。

## レビュー
Codex 1R（initial / gpt-5.6-sol / effort=medium・サイズ起因 high を sol 較正で一段下げ）。blockers 0・should_fix 1・nits 0。累計 150,382 / 500,000 トークン。WONTFIX 1 件（上記）。**挙動を変える修正は 0 件**なので「再レビューせずに修正した指摘」は無し。

## ★残 DoD / 注意
- **AC-21（manual）未確認**: 本番で「大会」タブと `/events` → `/events-no-entrants` の導線・一覧が期待どおり出るかを実機確認する。
- **ローカル vitest は1件も実行していない**: Docker Desktop が起動せずテスト DB `127.0.0.1:5434` へ到達不可（vitest は global-setup で毎回 drizzle-kit push するため DB 無しでは走らない）。`tsc --noEmit` のみ通過、eslint はタイムアウトで未完。**CI 完了前にマージしたので、CI が赤なら /quickfix で追修正**。
