---
name: feedback-drizzle-kit-push-prompt
description: drizzle-kit push は既存データありで UNIQUE 制約追加すると interactive プロンプトを要求して TTY なし環境で詰む。本番では db:migrate を使う
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# 本番 migration は `db:push` ではなく `db:migrate` を使う

`drizzle-kit push --force` は既存テーブルに非互換変更 (例: UNIQUE 制約追加で既存行が違反する可能性) を当てるとき **`Do you want to truncate ...` の interactive prompt** を出す。`--force` フラグは migration file の競合無視用で、prompt 抑制ではない。SSH 経由のスクリプト実行では TTY が無いため `Error: Interactive prompts require a TTY terminal` で詰む。

**回避策**: `drizzle-kit migrate` を使う

```bash
sudo -u kagetra bash -c "cd /opt/kagetra && set -a && source .env.production && set +a && corepack pnpm --filter @kagetra/shared db:migrate"
```

- `db:migrate` は `_journal.json` を読んで未適用の SQL ファイルを順に流す
- interactive prompt は出ない
- `__drizzle_migrations` テーブルで適用済みを記録

**Why:** `db:push` は dev/test 環境で「現在のスキーマと一致させる」用途で、prompt は安全策。本番は事前に generate した SQL ファイル群を順序適用する `migrate` が本来の使い方。docs/deploy/event-line-broadcast.md §2 は `db:push --force` と書いてあるが、これは初回適用以外では危険なので `db:migrate` に書き換えるべき (carryover)。

**How to apply:** 本番 migration は常に `db:migrate`。ローカル dev で `db:push` を使うのは可。

## 関連
- [[project-event-line-broadcast-deploy]] — 2026-05-31 本番デプロイで発覚
