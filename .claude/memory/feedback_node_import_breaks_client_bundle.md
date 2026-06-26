---
name: feedback_node_import_breaks_client_bundle
description: "client component が node: 付き import を持つモジュールを import するとブラウザビルドが壊れる"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8b0e4ed6-4d28-4697-9c93-8c2f228139d6
---

`'use client'` コンポーネントが、トップレベルで `node:crypto`（や `node:*` 全般）を import しているモジュールから **何か（定数・型でも可）** を import すると、webpack がそのモジュール全体をブラウザ向けにバンドルしようとして `UnhandledSchemeError: Reading from "node:crypto" is not handled` でビルドが落ちる。ページが真っ白／500 になる。

**Why:** モジュール単位でバンドルされるため、client が使うのが client-safe な export（プリセット定数など）だけでも、同じファイルにある `import { randomBytes } from 'node:crypto'` が道連れでブラウザバンドルに入る。tree-shaking は import 文の除去までは保証しない。

**How to apply:**
- client から import される可能性があるモジュールは `node:*` import を持たせない。
- トークン/乱数生成は Web Crypto グローバル（`crypto.getRandomValues` + `btoa` で base64url）にすると Node18+/ブラウザ/Edge 同形で client-bundle-safe。`randomBytes(32).toString('base64url')` と同じ 43 文字 base64url が作れる。
- どうしても `node:*` が要るなら、client-safe な定数/型と server-only ロジックを別ファイルに分割する。
- **この種のバグは vitest（esbuild, 型のみ）や tsc では検出できない。実ビルド or E2E（Playwright が dev server を起動する）でしか落ちない** → UI を伴う機能は E2E を必ず通す。invite-link-registration の管理者発行 E2E がこれを実検出した（[[impl_invite_link_registration]]）。
