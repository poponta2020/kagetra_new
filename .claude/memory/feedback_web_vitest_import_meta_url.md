---
name: feedback-web-vitest-import-meta-url
description: apps/web の vitest(jsdom) で import.meta.url は file: にならない
type: feedback
---

apps/web の vitest は jsdom 環境で走るため、**`import.meta.url` が file: スキームにならず `fileURLToPath()` が `TypeError: The URL must be of scheme file` で throw する**。

**Why:** apps/mail-worker のテストは node 環境なので `fileURLToPath(new URL('./fixtures/', import.meta.url))` が動く。その先例をそのまま apps/web へ持ち込むと落ちる——同じリポジトリ内なのに片方だけ動く、という形で紛れ込みやすい。

**How to apply:** apps/web のテストで fixture のパスを解決するときは `resolve(process.cwd(), 'src/…/__fixtures__')` を使う（web の vitest は root = apps/web で走る）。既存の `src/lib/entry-form/cell-map.test.ts` が正の形。

関連: [[impl-entry-form-autofill]]
