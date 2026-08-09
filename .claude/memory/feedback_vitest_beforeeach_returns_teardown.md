---
name: feedback-vitest-beforeeach-returns-teardown
description: vitest の beforeEach は返り値の関数を teardown 扱いする
type: feedback
---

vitest の `beforeEach`/`afterEach` は **コールバックが返した関数を teardown として登録し、テスト後に呼んでその戻り値を await する**。そのため `beforeEach(() => mock.mockReset())` はアロー関数の暗黙 return でモック本体を返してしまい、vitest がテスト後に**そのモックを呼ぶ**。

**Why:** テスト中に `mockImplementation(() => new Promise(() => {}))` のような never-resolve 実装を差し込んでいると（多重実行ガードやローディング表示のテストで常用）、teardown がその Promise を await して `Hook timed out in 10000ms` で落ちる。エラーの指す行は `beforeEach` なので、原因のテスト本体からは目が離れる。

**How to apply:** リセット系フックは**必ずブロックで囲む** — `beforeEach(() => { mock.mockReset() })`。既存コードにも同じ形が複数あるが（`players/ranking/RankingList.test.tsx` 等）、never-resolve 実装を残さないため顕在化していないだけ。新規に「Promise を解決させないテスト」を書くときは真っ先に疑う。

関連: [[feedback-vitest-no-file-parallelism]] / [[impl-member-mail-search-wave2-4]]
