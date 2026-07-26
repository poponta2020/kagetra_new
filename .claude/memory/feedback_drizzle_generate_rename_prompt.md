---
name: drizzle-generate-rename-prompt
description: drizzle-kit generate は列リネームらしい差分で対話プロンプトを出し、非TTY環境では必ず失敗する。列の付け替えは2パスに分ける
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c018ba76-c2fb-47cc-87ed-382282361114
  modified: 2026-07-26T18:34:40.109Z
---

`drizzle-kit generate` は「同一テーブルで1列 追加 + 1列 削除」の差分を**リネーム候補と見なして対話プロンプト**を出す。Claude Code の Bash は非TTY なので必ずこう落ちる:

```
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
    at promptColumnsConflicts (...)
```

**Why:** 既知の `drizzle-kit push` の interactive prompt 問題（[[drizzle-kit-push-prompt]]）と同根だが、**`generate` でも起きる**点が見落としやすい。`--force` は push 用で generate のリネーム解決には効かない。

**How to apply:** FK 列の帰属を付け替える（例: `event_line_broadcasts.event_id` → `entry_group_id`）ときは、1回の generate で済ませようとしない。**2パスに分ける**:

1. スキーマに**新列だけを nullable で追加**（旧列は残したまま）→ `db:generate` → 追加のみなので曖昧性が無く通る → 生成 SQL を手修正して backfill + fail-loudly ガード + `SET NOT NULL` + UNIQUE を挿入
2. スキーマから**旧列を削除**→ `db:generate` → DROP のみなので曖昧性が無く通る

結果 migration が2本になるので**番号計画がずれる**（例: 0046=LINE の予定が 0046+0047 を消費し、名簿は 0048+0049 になる）。番号は実装詳細なので、**同一 PR に全部入れる**限り本番が中間状態を見ることはない。

**代替（非推奨）:** SQL とスナップショット JSON を完全に手書きする。スナップショットの手書きは以降の generate 全部に影響するので避ける。

**検証:** migration の backfill は vitest では走らない（global-setup が `drizzle-kit push --force` で最終スキーマを直接 push する）。scratch DB へ 0000 から順に当てて実測するのが唯一の手段 — 手順は [[impl-entry-groups-task1]] に記録済み。
