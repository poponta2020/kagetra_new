---
name: feedback_drizzle_sql_int_array_binding
description: "drizzle 0.45 の sql 補間に JS 配列を直接渡すと malformed array literal で落ちる。ANY(ARRAY[...]) で要素展開する"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b78baef-f8ee-4a1b-95ce-95b6fd38f882
---

drizzle-orm 0.45 で `db.execute(sql\`... ANY(${playerIds}::int[])\`)` のように **JS 配列をそのまま `sql` 補間へ渡すと壊れる**。配列は単一スカラとしてバインドされ `ANY(($1)::int[])` の `$1` に `"1"`（配列リテラルでない文字列）が入り、Postgres が `malformed array literal: "1"` で実行時失敗する。

**正**: 要素ごとにプレースホルダ展開する。
```ts
sql`WHERE id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[])`
```
これは drizzle の `inArray` 内部と同方式（各要素が確実にパラメータ化され SQL インジェクション安全）。空配列は `ARRAY[]` が型推論できず壊れるので **呼び出し側で空配列 early-return** を入れる。

**Why**: 計画書の SQL 文字列（`ANY(${arr}::int[])`）をそのままコピペすると動かない。raw SQL で `int[]`/`text[]` パラメータを使う箇所すべてで再発する罠。

**How to apply**: 複雑な raw SQL を書くとき、配列パラメータは必ず `ANY(ARRAY[...])` の要素展開 or `inArray()` を使う。`${array}::type[]` の直接補間は禁止。2026-06-25 [[project_player_name_display_mode]] の recompute 関数（PR #170）で実害・解決済み。
