---
name: feedback-vitest-shared-mock-not-called-oom
description: 共有モックへのnot.toHaveBeenCalledはmockClear必須
type: feedback
---

共有された `vi.fn()` モックに対して `expect(mock).not.toHaveBeenCalled()` を書くときは、必ず `beforeEach` で `mockClear()` する。

**Why:** モックがファイル全体で共有されていると、先行する describe が既に呼び出しを積んでいる。クリアせずに否定アサーションを書くと必ず失敗し、そのとき vitest が**積み上がった引数を pretty-print しようとして `RangeError: Invalid string length` → `FATAL ERROR: JavaScript heap out of memory` でプロセスごと落ちる**。引数が大きいモック（LINE 配信 payload・HTTP レスポンス・DOM ツリー等）ほど確実に死ぬ。

**How to apply:** ファイル先頭の `vi.hoisted` / `vi.mock` で作ったモックを別の describe から否定形で見るなら、その describe の `beforeEach` に `mock.mockClear()` を入れる。症状の見分け方 —— **テスト単体（`-t` 指定）では通るのにファイル全体だと OOM で落ちる**なら、まずこれを疑う（アサーションの論理エラーがヒープ枯渇として現れるので、原因がテスト本体に見えない）。

kagetra_new の `apps/web/src/app/(app)/events/[id]/actions.test.ts`（guest-role AC-30 追加時）で実発生。関連: [[impl-guest-role-wave-b]]
