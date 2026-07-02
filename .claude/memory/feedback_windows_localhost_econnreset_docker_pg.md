---
name: feedback_windows_localhost_econnreset_docker_pg
description: Windows で host→docker Postgres は localhost が ECONNRESET・127.0.0.1 必須
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a304bc14-aef1-40ad-b9e2-74683db0f9a8
---

Windows で **ホストプロセス（node/pg・drizzle-kit）から docker の Postgres へ接続**するとき、`postgresql://...@localhost:5434/...` は `read ECONNRESET` で落ちる。`localhost` が IPv6(`::1`)へ解決され docker の port publish(`[::]:5434`)がリセットするため。**`127.0.0.1` を使えば通る**（IPv4 で `0.0.0.0:5434->5432` に届く）。

**Why:** vitest global-setup の `drizzle-kit push`（DATABASE_URL/TEST_DATABASE_URL 既定が localhost）や、生の pg クライアントが「Pulling schema… で無限スピン→exit1／drizzle-kit not found」に見える誤診を招いた。実体は接続断。

**How to apply:** テスト実行時は `TEST_DATABASE_URL='postgresql://kagetra:kagetra_dev@127.0.0.1:5434/<db>'` を渡す（global-setup と vitest.setup の両方が `TEST_DATABASE_URL ??` を見るので一箇所で効く）。docker exec 内の psql は unix socket なので無関係（そちらは `localhost` で可）。関連: [[feedback_windows_worktree_path]]（`/tmp` は node=C:\tmp / bash=%TEMP% でズレる。docker exec の stdin は `-i` 必須・`-t <table>` はスキーマ修飾 `public.` を付けないこと）。
