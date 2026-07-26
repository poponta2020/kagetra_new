---
name: ship-entry-management
description: 申込管理ボード /admin/entries 出荷
type: project
---

PR #334 — feat: 管理者向け申込管理ボード /admin/entries を新設（entry-management）
https://github.com/poponta2020/kagetra_new/pull/334 — **マージ済み**（merge commit 5ea1c44）

親 Issue #322 と子 #323/#324/#325/#326 はすべてクローズ済み。

## 出荷内容

- `/admin/entries`（管理者専用・表示専用）を新設。5 区画（締切前 → 要対応 → 申込済み・抽選待ち → 名簿確定・振込待ち → 完了）へ自動仕分け。**スキーマ変更なし**（既存列からの導出）
- ボトムナビに 7 個目の管理者専用タブ「申込管理」
- entry-overdue-alert の毎朝アラートに `attendCount >= 1` を追加（画面と LINE の定義を一致）
- 正典 docs 更新: spec/events-attendance.md / spec/ui-shell.md / spec/notifications.md / SPECIFICATION.md / design/design.md / features/INDEX.md

## レビュー

Codex 2R・effort high・累計 389,318 トークン。R1 で blocker 1（畳んだ区画の「ほかN件」欠落）+ should_fix 1（進行状態型の重複定義）→ R2 pass。詳細は [[auto-review-round-pr334]]。

## ★出荷時に踏んだ地雷（次回のため）

1. **PR が DIRTY だと CI が1本も起動しない。** 作業中に PR #333 が main へマージされ `docs/features/INDEX.md` が競合。GitHub は競合中の PR に対して merge ref を作れないため `pull_request` トリガーのワークフローが走らず、`gh pr checks` は「no checks reported」を返す。**gate-dod.sh の B1 は `gh pr checks` の exit code で判定するので、これを「CI 失敗」と誤判定して SHIP 不可になる。** 対処は main をマージして conflict を解消し push（＝synchronize で CI 起動）。
2. **ローカルのフルテストスイートを回す必要はない。** profile の `DEVFLOW_CI_COVERS` が test/lint/typecheck を CI へ委譲しており、gate-dod は CI green ならローカル再実行をスキップする。今回それを無視して4回回し、うち2回は他セッション（role-preview-switch / event-list-redesign）とテスト DB(5434) を共有して deadlock・FK 違反による偽の失敗を大量に出し、その切り分けに時間を溶かした。**ユーザーから「時間がかかりすぎ」と明確な指摘を受けた。**
   - どうしても並行セッション下でローカル実行が要る場合は `docker exec kagetra-db-test psql -U kagetra -d postgres -c "CREATE DATABASE kagetra_test_<slug>"` で DB を切り `TEST_DATABASE_URL` を向ける（drizzle-kit push はテーブルは作るが DB は作らない）。実際これで 116 files / 1507 passed / 0 failed が出た。
3. **メイン作業ディレクトリの未追跡 `docs/features/<slug>/` が pull を止める。** /define-feature の成果物がメイン側で untracked のまま残り、worktree 経由で main にマージされた後に `git pull` が「untracked working tree files would be overwritten」で失敗する。マージ済み版が正なので未追跡コピーを削除してから pull する。

## 残 DoD

AC-32（manual）: 本番で管理者が `/admin/entries` を開き、375px の 1 画面に 5 区画が収まること・仕分けが実運用の認識と一致することを確認する。
