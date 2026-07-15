---
name: impl-show-app-dev-session-helper
description: "/show-app コマンド + dev:session Cookieヘルパーで認証済みアプリ画面を in-app Browser pane にライブ表示(dev tooling)。PR #277 merge済"
metadata:
  type: project
  category: ship
  tags: [dev-tooling, show-app, in-app-pane, auth-cookie]
---

# /show-app コマンド + dev:session Cookieヘルパー（PR #277・merge済）

ブランチ `chore/show-app-inapp-viewer`。開発補助ツールの追加（ランタイム=本番バンドルには含まれない）。merge commit `6fe1433`・親Issue なし。

## 何を

- `.claude/commands/show-app.md`: `/show-app [local|prod] [route]` — 認証済みアプリ画面を in-app Browser pane にライブ表示するスラッシュコマンド。実走で得た学び（Fast path 手順・chrome-error 死ページ判定・launch.json の design-live/postgres 誤検知を無視・prod/local env 整合）を反映済み
- `apps/web/scripts/dev-session-cookie.ts` + `dev:session` script: 既存ユーザーを SELECT して Auth.js セッション Cookie(JWE) を発行（**INSERT しない=prod 安全**）。`dev-issue-cookie.ts` の prod 安全版
- memory reference 2件: [[reference_inapp_pane_app_view]]（pane 表示レシピ）/ [[reference_prod_db_tunnel_connect]]（本番DB SSHトンネル接続）

## なぜ

in-app Browser pane はトップレベル 307 リダイレクトを追従できず `ERR_TOO_MANY_REDIRECTS` になる。`/` を踏ませず `/sw.js` 経由で Cookie 注入→200 ページ直行、という手順を再現可能にするため。

## レビュー

Codex 1R pass（effort=medium・22,397 tokens・blockers 0 / should_fix 0 / nits 1）。AC適合チェックは v0.9.0 で標準ループ外（未実施）。nit 1件対応: dev:session は prod DB にも接続しうるため、`[dev-session] minted` の stderr 診断行から `name=${u.name}` を除去し role/id のみに（token 内の name はセッションに必要なので保持）。commit `3014b31`。

## 出荷

PR #277 <https://github.com/poponta2020/kagetra_new/pull/277> merge成功（`--merge`）・CI は pending のままマージ（v0.9.0 方針・赤なら追修正）。DoD ゲート全PASS。
