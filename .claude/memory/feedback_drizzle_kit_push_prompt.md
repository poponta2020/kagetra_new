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

## 同じ罠のテスト DB 版（2026-07-27・PR #378 の出荷時）

vitest の global-setup は起動のたびに `drizzle-kit push --force` をテスト DB へ流す。**列リネームを含む migration がマージされた後**、既存のテスト DB は旧スキーマのままなので push が「リネームか drop/add か」の対話プロンプトを出し、非TTY で `Error: Interactive prompts require a TTY terminal` になって **DB を使うテストが全滅**する（gate-dod の A1 が丸ごと FAIL に見える。PR の中身は無実）。

- 症状の見分け方: 失敗が特定機能ではなく DB 依存スイート全体に及び、ログ先頭に上記 TTY エラーが出る
- 対処: そのワークツリーのテスト DB を捨てる（global-setup が作り直す）。DB 名は worktree パス由来（`packages/shared/src/test-db.ts`）
  ```bash
  docker exec kagetra-db-test psql -U kagetra -d postgres -c "DROP DATABASE IF EXISTS kagetra_test_<slug>_<hash>;"
  ```
- **How to apply:** 列リネームを含む migration をマージしたら、各 workdir・worktree のテスト DB を一度捨てる。新規に作った worktree では起きない（毎回新規作成のため）＝「worktree では green なのにメインで赤」の典型パターン

## 関連
- [[project-event-line-broadcast-deploy]] — 2026-05-31 本番デプロイで発覚
- [[ship-entry-board-visible-to-members]] — 2026-07-27 テスト DB 版を踏んだ出荷
