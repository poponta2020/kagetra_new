---
name: feedback-test-db-leftover-rows-fk-restrict
description: テストDBの持ち越し行がFK RESTRICTで隣のファイルを落とす
type: feedback
---

`apps/web` の DB テストは `beforeEach(truncateAll)` が規約だが、**ファイル固有の手書き `resetDb()`（生 delete）を持つテストファイルが混ざっている**と、新しいテストファイルを足しただけで無関係なファイルが落ちる。

**Why:** `tournament_entry_rosters` / `tournament_entry_roster_files` → `entry_groups` の FK は **RESTRICT**。同じ DB を使うテストファイルは順に走り、各ファイルは `beforeEach` で消すだけなので**最後のテストの行は次のファイルへ持ち越される**。持ち越し先が `truncateAll()`（CASCADE）なら無害だが、`delete from entry_groups` を直接書いているファイルは FK 違反で全テストが落ちる。落ちるのは**新規ファイルではなく既存ファイル**なので、原因がローカルの部分実行では見えず CI で初めて出る。

実例: PR #513 で `src/lib/events/confirmed-roster.test.ts` を追加 → 実行順で隣接した `src/lib/line-broadcast-helpers.test.ts` の 17 件が一斉に FAIL（`Key (id)=(2) is still referenced from table "tournament_entry_rosters"`）。

**How to apply:**
- DB テストの後始末は**必ず `truncateAll()`**（`@/test-utils/db`）。ファイル固有の生 delete を書かない。新テーブルを足したら `truncateAll` の列挙に加える
- `tournament_entry_rosters` / `tournament_entry_roster_files` を insert するテストファイルを新設したら、**近い名前の既存 DB テストが落ちないか**を「2ファイルを順に実行」して確認する: `pnpm --filter=@kagetra/web test -- --no-file-parallelism <新規> <隣接ファイル>`（この確認のときだけ `--no-file-parallelism` を使う。持ち越しを再現させたいので**わざと**同じ DB へ流す）
- ★**2026-09-07 以降、どのファイルが同じ DB を共有するかは実行ごとに変わる**（worker ごとのテスト DB を `VITEST_POOL_ID` で分けており、ファイルの割り当ては非決定的）。「直前に走ったファイル」を特定しづらくなった一方、規約どおり `truncateAll()` を使っていれば順序に依存しない。生 delete を書かないことの重要性が上がった
- 症状の見分け方: CI のエラーが `Failed query: delete from "entry_groups"` / `code: '23503'` なら、犯人は落ちているファイルではなく**その直前に走ったファイル**
