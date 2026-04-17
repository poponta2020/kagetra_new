# DB マイグレーション運用

Drizzle ORM + PostgreSQL 16。マイグレーションは `packages/shared/drizzle/` に格納。

## コマンド

```bash
# スキーマ変更時: SQL 生成
pnpm --filter @kagetra/shared db:generate

# 適用（マイグレーション履歴を記録）
pnpm --filter @kagetra/shared db:migrate

# 開発時の一括同期（マイグレーション履歴なし、履歴を気にしない場合）
pnpm --filter @kagetra/shared db:push
```

## 初期マイグレーション前提

- **本プロジェクトはグリーンフィールド**。`0000_*.sql` は全テーブル・enum の初期作成を含む
- そのため **既存データがある DB に対して `db:migrate` を実行すると `already exists` で失敗する**
- `db:push` で先にスキーマを流し込んだ開発環境では、`db:migrate` 実行前に DB をリセットすること

### 開発環境のリセット手順

```bash
docker exec kagetra-db psql -U kagetra -d kagetra \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO kagetra; GRANT ALL ON SCHEMA public TO public;"

pnpm --filter @kagetra/shared db:migrate
```

## 本番/CI への適用方針

- 本番 (Lightsail) / CI は **空 DB から `db:migrate` で初期化**することを前提とする
- Phase 1-5 のデータ移行スクリプトは「マイグレーション適用済み・テーブルは空」の状態から実行する
- マイグレーション SQL ファイルは必ずコミット済みにしてからデプロイする

## 命名規則と衝突回避

- ファイル名は `drizzle-kit generate` が自動採番（連番 + ランダム名）
- 並行ブランチで同じ番号のマイグレーションが生まれた場合は、マージ時に片方をリネーム + メタ JSON を再生成する
- Phase またぎの大きな変更は、可能な限り 1 マイグレーションにまとめる（履歴の可読性向上）
