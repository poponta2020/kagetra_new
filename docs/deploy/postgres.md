# PostgreSQL (Docker) セットアップ

kagetra_new 本番の PostgreSQL 16 を Docker Compose で同居起動する手順。
`docker/docker-compose.prod.yml` を使い、localhost (127.0.0.1:5432) bind
厳守で外部公開しない。drizzle migration の適用は
`scripts/deploy/apply-migrations.sh` で psql 経由実施 (drizzle-kit migrate は
TTY 必須で本番不適、Phase 0 Discovery 結果)。

## 0. 前提

- Phase A 完了 (`docs/deploy/oracle-setup.md` / `docs/deploy/dns-ssl.md`)
- Docker / Docker Compose plugin install 済 (`oracle-setup.md` §8)
- `.env.production` が `/opt/kagetra/.env.production` に配置済 (mode 0600,
  owner `kagetra`、`POSTGRES_PASSWORD` / `DATABASE_URL` / `AUTH_SECRET` /
  `AUTH_LINE_*` / `ANTHROPIC_API_KEY` 等を含む)
- `/opt/kagetra/` に git clone 済 (`docs/deploy/mail-worker.md` §1 と同じ
  手順、`useradd -r` + `install -d` + `git clone`)

## 1. docker compose 起動

```bash
cd /opt/kagetra
sudo -u kagetra docker compose -f docker/docker-compose.prod.yml up -d
```

起動確認:

```bash
sudo -u kagetra docker compose -f docker/docker-compose.prod.yml ps
```

healthcheck が pass するまで 10〜30 秒待つ (status が `healthy` になれば OK)。

## 2. DB 接続確認

```bash
sudo -u kagetra docker exec -it kagetra-postgres psql -U kagetra -d kagetra -c '\dt'
```

→ 何もテーブルがない状態 (Tables: empty) で正常 (まだ migration 未適用)。

## 3. jq install (apply-migrations.sh の依存)

```bash
sudo apt install -y jq postgresql-client
```

- `jq`: apply-migrations.sh が drizzle journal (`_journal.json`) を parse
  するのに使う
- `postgresql-client`: host から psql を直接実行する用。docker exec 経由
  なら不要だが、apply-migrations.sh は host で実行する想定なので入れておく

## 4. migration 適用

```bash
cd /opt/kagetra
sudo -u kagetra bash -c 'source .env.production && export DATABASE_URL="postgres://kagetra:$POSTGRES_PASSWORD@127.0.0.1:5432/kagetra?sslmode=disable" && bash scripts/deploy/apply-migrations.sh'
```

- 実値は env 経由で渡し、`POSTGRES_PASSWORD` を CLI に直接書かない
- 0000-0011 の 12 migration が順次 APPLY、success 出力で完了
- 再実行は SKIP メッセージ (idempotent、`__drizzle_migrations` テーブルで
  既適用 hash を見て分岐)

## 5. 接続テスト

```bash
sudo -u kagetra docker exec -it kagetra-postgres psql -U kagetra -d kagetra -c '\dt'
```

→ `users` / `events` / `event_attendances` / `mail_messages` 等
(10+ tables) が見える。

## 6. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| `docker compose up -d` で port 5432 already in use | host の PostgreSQL が既に動いている、`sudo systemctl stop postgresql` で止める (kagetra は Docker 経由のみ使う想定) |
| apply-migrations.sh で `psql: command not found` | postgresql-client 未 install、§3 参照 |
| apply-migrations.sh で `jq: command not found` | jq 未 install、§3 参照 |
| apply-migrations.sh で permission denied | `chmod +x scripts/deploy/apply-migrations.sh` |
| migration が部分適用で失敗 | 個別 SQL の構文エラー or schema 衝突、pg_dump からの restore が必要 (Phase C `backup-restore.md` 参照、まだ未整備なので docker volume 削除 + 最初から: `docker compose -f docker/docker-compose.prod.yml down -v` で kagetra-pgdata を消す) |
| `__drizzle_migrations` テーブルが見えない | drizzle schema (`SET search_path TO drizzle;` または `SELECT * FROM drizzle.__drizzle_migrations;`) |
