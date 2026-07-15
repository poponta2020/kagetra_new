---
name: reference_inapp_pane_app_view
description: Claude Code の in-app ブラウザで kagetra アプリのログイン後画面をライブ表示する手順（/show-app コマンド）
metadata:
  type: reference
---

Claude Code の in-app Browser pane で認証必須のアプリ画面を見る手順。**コマンド化済み: `/show-app [local|prod] [route]`**（`.claude/commands/show-app.md`。cookie 発行は `apps/web/scripts/dev-session-cookie.ts`）。

**根本の罠**: in-app ブラウザは**トップレベルの HTTP リダイレクト(307)を追従できない**。同じ URL を再リクエストし続け `ERR_TOO_MANY_REDIRECTS` に陥り `(non-http)` エラーページになる（スクショ timeout・`document.cookie` 拒否は全部この二次症状）。このアプリは `/` でリダイレクトする（未認証→`/auth/signin`、認証→`/dashboard`）ので **pane を `/` に遷移させない**。必ず**リダイレクトしない 200 ページに直接遷移**する。サーバー自体は正常（curl/Playwright は普通に追従して 200 になる＝アプリの不具合ではない）。

**手順**:
1. `preview_start web`（launch.json は `cmd /c corepack pnpm dev`。preview ランナーの PATH に pnpm グローバル bin が無く素の `pnpm` は `ENOENT`/未認識になるため corepack 経由。ここを素の pnpm に戻さない）。
2. Cookie 発行: `pnpm --silent --filter @kagetra/web dev:session -- --role=admin 2>/dev/null | tail -n1 | tr -d '\r\n'`。`--silent`+`tail -n1` 必須（pnpm のバナーがトークンに混ざり 4dots JWE が壊れる）。`dev:session` は既存ユーザーを SELECT するだけで **INSERT しない**＝prod 安全。`dev:cookie` は `dev-admin@kagetra.local` を **INSERT** するので prod 接続時は使用禁止。
3. pane を `http://localhost:3000/sw.js` に直接遷移（auth middleware 対象外の静的ファイル＝常に 200・スクリプト可能）。
4. `javascript_tool` で `document.cookie="authjs.session-token=<TOKEN>; Path=/; Max-Age=604800; SameSite=Lax"` を注入→`fetch('/api/auth/session')` が user を返すこと確認。既存 HttpOnly セッションがあると JS で上書き不可なので session が null であること前提（残っていれば `/api/auth/signout` 等で先に消す）。
5. pane を目的の 200 ページ（`/dashboard`・`/tournaments`・`/players` 等）に**直接遷移**→描画。下ナビのクリックはクライアント遷移でリダイレクト無し＝pane 内で回遊 OK。

**確実な代替（静止画）**: live pane が不要なら Playwright headless で任意ページをスクショ→画像提示が最速・最堅（`scripts/diagnostics/shot.cjs`、認証は同じ minted cookie を `addCookies`）。

本番データで見るには [[reference_prod_db_tunnel_connect]] を先に実施（`/show-app prod`）。認証の仕組みは [[feedback_auth_js_jwt_strategy_user_id]]。
