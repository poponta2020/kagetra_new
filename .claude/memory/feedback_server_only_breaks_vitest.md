---
name: feedback-server-only-breaks-vitest
description: server-only は vitest から import すると throw する
type: feedback
---

vitest から `import 'server-only'` を含むモジュールをテストすると、**モジュール解決の時点で throw して suite ごと落ちる**。

**Why:** `server-only` パッケージの実体は exports が `{ 'react-server': './empty.js', 'default': './index.js' }` で、index.js は「This module cannot be imported from a Client Component module」を throw する1行だけ。Next のビルドだけが react-server condition を立てて空実装へ差し替えるので、素の Node/vitest からは必ず throw 側が読まれる。eslint も typecheck も通るため、**vitest を実行するまで気づかない**（並行ワーカーに `worker_verify: none` を課している都合上、バリアまで発覚が遅れる）。

**How to apply:** サーバー専用モジュールに `import 'server-only'` を付けたら、`apps/web/vitest.config.mts` の `resolve.alias` で空実装へ向ける。既に `src/test-utils/server-only-stub.ts` があるのでそれを指す。**パッケージ同梱の `server-only/empty.js` を alias 先にしてはいけない**——exports マップに載っておらず Vite が「Missing "./empty.js" specifier」で落ちる。

関連: [[feedback-node-import-breaks-client-bundle]] / [[impl-entry-form-autofill]]
