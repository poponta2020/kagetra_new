---
name: auto-review-round-pr312
description: auto-review PR #312
type: project
---

PR #312 (feature/entry-overdue-alert) の /auto-review-loop 記録。

- **R1** effort=high verdict=needs_changes blockers=1 should_fix=2 nits=0 round_tokens=175,160
  - [B] systemd .timer の Requires= が enable --now で service を即時起動 → 非冪等アラートが重複 push
  - [S] PUBLIC_BASE_URL の https:// 未検証 / [S] requirements.md §3.2.2 と §8 の矛盾
  - → commit ac60c50 で修正
- **R2** effort=high verdict=needs_changes blockers=1 should_fix=1 nits=0 round_tokens=154,642
  - [B] infra/sudoers/kagetra-deploy に新規 unit の allowlist 追記漏れ → auto-deploy が最初の install で sudo に蹴られ確実に fail
  - [S] デプロイ手順の順序（db:migrate が git pull より前）→ 0043 未適用のまま web 起動で enum invalid input
  - → commit 72d986b で修正
- **R3** effort=high verdict=needs_changes blockers=1 should_fix=0 nits=0 round_tokens=274,285
  - [B] §0 の sudoers 先行配置手順が git checkout <ref> -- <path> で index を汚し、auto-deploy.sh:25 の作業ツリークリーン検査で中断させる
  - → commit a8aac23 で修正（**この修正は未レビュー**）
- **R4** effort=high verdict=**pass** blockers=0 should_fix=0 nits=0 round_tokens=172,969
  - R3 の修正（a8aac23）を含む全差分で指摘ゼロ。デプロイ経路（systemd unit + sudoers + 先行配置手順）も整合と判定された
- cumulative_tokens=777,056（既定上限 500,000 をユーザー承認で引き上げて R4 を実行。R4 開始前に一度 token-budget で中断していた）
- 最終 result=**pass**。CI（Lint / Typecheck / Test）も green を確認
- escalated=false（初回から high。差分に schema/migration を含むため）

## 学び
Codex の 3 ラウンドはすべて**デプロイ経路の指摘**で、アプリコードの blocker はゼロだった。新規 systemd unit を足す変更では、unit ファイル単体ではなく (1) sudoers allowlist (2) auto-deploy の前提（クリーンな作業ツリー） (3) migration とコード取得の順序、の 3 点セットで見る必要がある。infra/sudoers/kagetra-deploy 自身がこの手順を明記していたのに実装時に読んでいなかった。

結果ファイル: scripts/review/output/codex-result-pr312-r{1,2,3}.json
