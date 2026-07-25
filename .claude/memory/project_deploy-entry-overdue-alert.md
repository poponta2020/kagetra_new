---
name: deploy-entry-overdue-alert
description: entry-overdue-alert 本番デプロイ(2026-07-26)
type: project
---

entry-overdue-alert (PR #312) の本番デプロイ記録（2026-07-25 深夜〜2026-07-26 01:50 JST 実施）。

## 経緯: 自動デプロイが sudoers 未反映で失敗していた
PR #312 のマージで走った auto-deploy は **failure**。Codex R2 の blocker が現実になった形で、`install kagetra-entry-overdue-alert.service` で `sudo: a password is required` → `DEPLOY_RESULT=FAILED`。
その直後の docs-only コミットの deploy は **success** だったが、これは `no buildable code changed — skipping build & restart` で**何もしていない**成功。ログを見ずに緑だけ見ると復旧済みと誤認する。

**失敗時点で到達していた工程**（実測）:
- git pull / pnpm install: 完了
- build（.next/standalone mtime = 21:07 JST）: 完了
- **migration 0043: 適用済み**（`APPLY: 0043_entry_status_not_applying` / applied=1）
- systemd unit の install: ← ここで停止
- web restart: 未実行（7/21 起動のまま = 旧プロセス）

## 実施した復旧手順
1. repo 内 sudoers を `visudo -c -f` で検証（parsed OK・CRLF 0）→ `/etc/sudoers.d/` へ install → `sudo -n true` で sudo 健全性確認
2. **deploy ユーザー（kagetra）として** `sudo -n` で install/daemon-reload/enable/restart/is-active を実行し allowlist が効くことを実証（ubuntu の全権 sudo では検証にならない）
3. web restart（新ビルドは既にディスク上にあったため再ビルド不要）→ is-active / HTTP 200
4. timer `enable --now` → **R1 の修正を実地検証**: service は `inactive`・ActiveEnterTimestamp `n/a`・journal `No entries`（一度も走っていない）。`Requires=` を残していたらここで実通知が飛んでいた
5. §4-a dry-run: 対象 18 件・上位5件+「他 13件」・絶対 URL 正常
6. §4-b `LINE_NOTIFY_DRY_RUN=1`: system チャネル解決 → 管理者 userId 解決 → 文面組立 → push 直前まで通過（`18 candidate(s), push sent`）

## AC-21 の状態
**未完了。** 01:47 JST に実送信すると管理者の端末が深夜に鳴るため、ユーザー判断で **2026-07-26 07:00 JST の自動発火に委ねた**。次回発火は `systemctl list-timers` で確認済み（NEXT = Sun 2026-07-26 07:00:00 JST）。朝に LINE が届けば AC-21 完了。

## 再発防止
手順書の不備は PR #320 で修正済み（[[auto-review-round-pr320]]）。
**教訓: 新規 systemd unit を追加する PR は、マージ前に sudoers を本番へ配置しないと必ず auto-deploy が落ちる。** そして落ちても migration は適用済みなので、DB とコードの版が食い違った状態で放置される。
