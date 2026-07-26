---
name: design-screen-path-l-env
description: /design-screen Path L のローカル環境
type: reference
---

# /design-screen Path L のローカル環境（2026-07-26 に確立）

`/design-screen` の Path L（ライブプロト）を kagetra で回すときの環境の実体。3 つ罠がある。

## 1. ★ensure-worktree.sh の `design-live` は別プロジェクトのものを返す
`bash scripts/ensure-worktree.sh design-live design/<slug>` は `C:/tmp/design-live` を返すが、
**これは match-tracker（別リポジトリ）の worktree**。kagetra の実体は `C:/tmp/design-live-kagetra`。
名前衝突でスクリプトが `-kagetra` を付けて逃がした過去の痕跡。
- 使う前に必ず `git -C <path> remote -v` か `git worktree list`（メインリポジトリ側）で確認する。
- 誤って別プロジェクトの worktree でブランチを切り替えたら、元のブランチへ checkout し直し、
  作った branch を `git branch -D` して戻すこと。

## 2. preview_start は絶対パス cwd を拒否する
launch.json の `cwd` に `C:/tmp/...` を書くと `cwd must be a relative path within the project root`
で起動できない。解決＝プロジェクトルートに**ジャンクション**を張って相対パスで指す:
```
cmd /c mklink /J ".design-live" "C:\tmp\design-live-kagetra"
```
`.gitignore` に `.design-live` を追加済み。launch.json の design-live エントリは
`"cwd": ".design-live/apps/web"`（port 3100）。

## 3. ★in-app pane の cookie 注入は HTML ページで行う
`/show-app` の手順どおり `/sw.js` に着地して `document.cookie = ...` しても、
**成功したように見えて cookie がサーバーに届かない**（`/api/auth/session` が null のまま →
以後 `/dashboard` へ navigate すると全部リダイレクトループで失敗）。
`curl` に `Cookie:` ヘッダを付けると同じトークンで 200 が返るので、トークンは正しい。
解決＝**健全なページから** `/auth/signin`（未認証時 HTML 200）へ navigate してそこで注入する。
死んだ chrome-error ページからの 1 回目の navigate は効かないので、先に `/sw.js` を挟むこと。
`.claude/commands/show-app.md` の step 6 に fallback として追記済み。

## 4. ローカル dev DB は移行台帳が壊れている
`drizzle.__drizzle_migrations` に 3 件しか無い（journal は 45 件）。dump 復元由来で
マイグレーション経由ではないため `drizzle-kit migrate` は既存オブジェクトと衝突して失敗する。
`mail_messages.triage_status` が無く `/events`・`/admin/*` はローカルで 500。
デザイン確認では /dashboard・/settings 系しか見られない前提で計画すること。
