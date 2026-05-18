#!/usr/bin/env bash
# kagetra_new 本番 migration 適用 script。
# drizzle-kit migrate は TTY 必須で本番不適 (Phase A Phase 0 Discovery 結果)、
# このため psql で SQL ファイルを順次適用 + __drizzle_migrations への hash INSERT
# を手動実施する。
#
# 使い方:
#   DATABASE_URL=postgres://... bash scripts/deploy/apply-migrations.sh
#
# 前提:
#   - psql コマンド利用可能 (Docker container 内 or host install)
#   - jq コマンド利用可能 (meta/_journal.json parse 用、apt install jq)
#   - sha256sum コマンド利用可能 (coreutils、Ubuntu default)
#   - packages/shared/drizzle/[0-9]*.sql が clone 済 (git clone /opt/kagetra 経由)
#
# 失敗時:
#   - any 1 migration が失敗すると script は即終了 (set -e + ON_ERROR_STOP=1)
#   - 部分適用された state からの復旧は pg_dump からの restore が確実

set -euo pipefail

# DATABASE_URL 必須 (未設定なら明示 fail)
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required (postgres://user:pass@host:port/db)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/packages/shared/drizzle"
JOURNAL_FILE="$MIGRATIONS_DIR/meta/_journal.json"

# dependencies チェック
for cmd in psql jq sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found in PATH. Install: apt install postgresql-client jq coreutils" >&2
    exit 1
  fi
done

if [ ! -f "$JOURNAL_FILE" ]; then
  echo "ERROR: journal file not found: $JOURNAL_FILE" >&2
  exit 1
fi

# __drizzle_migrations テーブル作成 (idempotent、drizzle-kit と同じ schema)
# drizzle 公式 internal schema:
#   schema=drizzle, table=__drizzle_migrations, columns=(id SERIAL PK, hash text NOT NULL, created_at bigint)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'EOSQL'
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
EOSQL

echo "Reading journal: $JOURNAL_FILE"

# journal entries を iterate
# tag (e.g. "0000_eager_kylun") + when (epoch ms) を取得
# 対応する .sql ファイル → sha256sum で hash 計算 → 既適用なら skip、未適用なら apply + INSERT
applied_count=0
skipped_count=0

while IFS=$'\t' read -r tag when; do
  sql_file="$MIGRATIONS_DIR/${tag}.sql"

  if [ ! -f "$sql_file" ]; then
    echo "ERROR: SQL file not found: $sql_file (journal entry tag=$tag)" >&2
    exit 1
  fi

  # SQL ファイル内容の SHA-256 hex 算出 (drizzle-kit と同じ計算式)
  hash=$(sha256sum "$sql_file" | awk '{print $1}')

  # 既適用 check (hash は psql 変数経由で渡して quote 注入を回避、`-v VAR=val`
  # で psql 変数を設定 + SQL 中の `:'VAR'` で文字列 quote 込み展開)
  is_applied=$(psql "$DATABASE_URL" -tA -v hash="$hash" -c \
    "SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = :'hash')")

  if [ "$is_applied" = "t" ]; then
    echo "SKIP: $tag (already applied, hash=$hash)"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  echo "APPLY: $tag (hash=$hash, when=$when)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql_file"

  # __drizzle_migrations への INSERT (drizzle-kit migrate と同じ挙動)
  # hash は :'hash' で文字列 quote、when は :when で bigint (数値そのまま)
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v hash="$hash" -v when="$when" -c \
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (:'hash', :when)"

  applied_count=$((applied_count + 1))
done < <(jq -r '.entries[] | "\(.tag)\t\(.when)"' "$JOURNAL_FILE")

echo ""
echo "Migration summary: applied=$applied_count, skipped=$skipped_count"
echo "All migrations completed successfully."
