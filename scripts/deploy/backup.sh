#!/usr/bin/env bash
# kagetra_new 本番 PostgreSQL バックアップ script。
# 日次 03:00 JST に systemd timer から起動され、以下を順次実行:
#   1. pg_dump (Docker postgres から custom format dump) → /var/backups/kagetra/daily/
#   2. Cloudflare R2 へ rclone copyto アップロード (daily/YYYY-MM-DD.dump)
#   3. 日曜 (DOW=7) なら weekly/ に cp + R2 へ upload
#   4. 月の 1 日 (DOM=01) なら monthly/ に cp + R2 へ upload
#   5. GFS rotation: local + R2 で 日次=7d / 週次=8w / 月次=12M より古いものを削除
#
# 失敗時 (どの stage でも non-zero exit) は ERR trap で
# apps/mail-worker/scripts/notify-system.ts を呼んで LINE 管理者通知し、
# 元の exit code を保ったまま終了する。
#
# Usage:
#   systemd timer 経由が正規ルート。手動実行は:
#     sudo systemctl start kagetra-backup.service
#   または env を export して:
#     bash /opt/kagetra/scripts/deploy/backup.sh

set -euo pipefail

# === env 必須チェック (apply-migrations.sh の ${VAR:?...} パターン) ===
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required (e.g. kagetra-backup)}"

# optional, default 付き
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/kagetra}"
KAGETRA_REPO_ROOT="${KAGETRA_REPO_ROOT:-/opt/kagetra}"

# DATABASE_URL は notify-system.ts (mail-worker) が getDb() で読むため export
# (script 内の bash 変数だけだと child process に伝播しないので明示 export)
export DATABASE_URL

# === 依存コマンドチェック ===
# tsx は mail-worker の node_modules/.bin から絶対 path で呼ぶため、
# ここでは外部 binary 群のみチェック (PATH 解決に任せる)。
for cmd in docker rclone find date stat hostname cp mkdir; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found in PATH" >&2
    exit 1
  fi
done

# tsx は絶対 path で固定 (本番 systemd の minimal PATH 環境でも確実に通すため、
# PATH 解決を当てにしない。pnpm install 直後の node_modules/.bin/tsx は
# launcher script として配置されており、systemd の Type=oneshot からも実行可)。
TSX_BIN="${KAGETRA_REPO_ROOT}/apps/mail-worker/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "ERROR: tsx binary not executable: $TSX_BIN" >&2
  echo "ERROR: run 'pnpm install --filter @kagetra/mail-worker' under $KAGETRA_REPO_ROOT first" >&2
  exit 1
fi

# === rclone env-var 注入 ===
# rclone は ~/.config/rclone/rclone.conf を読まず、env-var の remote 設定のみで動作。
# remote 名は "R2"、type=s3 + provider=Cloudflare + endpoint=<account>.r2.cloudflarestorage.com。
# NO_CHECK_BUCKET=true で初回 HeadBucket call (R2 ACL 制約で 403 になりがち) を skip。
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ACL=private
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"

RCLONE_OPTS=(
  --no-progress
  --log-level INFO
  --retries 3
  --low-level-retries 10
  --timeout 5m
  --contimeout 1m
)

# === 日付計算 (JST 明示) ===
# TZ=Asia/Tokyo で固定: systemd は UTC で走ることがあるため、明示しないと date 境界がずれる。
TS=$(TZ=Asia/Tokyo date +%Y%m%d-%H%M%S)
DATE_JST=$(TZ=Asia/Tokyo date +%Y-%m-%d)
DOW=$(TZ=Asia/Tokyo date +%u)   # 1=月 ... 7=日
DOM=$(TZ=Asia/Tokyo date +%d)

# === ERR trap (失敗通知) ===
# stage tracker は trap 内で参照可能なように script scope に置く。
BACKUP_STAGE="init"

notify_failure() {
  # ERR trap 発火時の $? は trap 内では既に再評価されるため、
  # 関数冒頭で即捕捉する (set -e 下でこれを忘れると常に 0 になる)。
  local exit_code=$?
  local stage="${BACKUP_STAGE}"
  local host
  host=$(hostname 2>/dev/null || echo "unknown-host")
  local msg
  msg="kagetra backup failed: stage=${stage}, exit=${exit_code}, host=${host}, ts=${TS} JST"

  echo "[backup] ERROR: $msg" >&2

  # cwd 非依存にするため絶対 path から呼ぶ。
  # notify-system.ts も内部で DATABASE_URL を要求するが、ここまでくれば既に export 済。
  # set -e は trap 内では一時的に無効 (関数 entry 時の状態を継承) なので、
  # notify-system.ts が失敗しても元の exit_code を保てる。
  if ! ( cd "$KAGETRA_REPO_ROOT" && "$TSX_BIN" apps/mail-worker/scripts/notify-system.ts "$msg" ); then
    echo "[backup] WARNING: notify-system.ts also failed; rely on journalctl" >&2
  fi

  # original exit code を保ったまま終了 (systemd timer が OnFailure= を発火する)
  exit "$exit_code"
}
trap notify_failure ERR

# === backup 本体 ===

# --- stage 1: pre_check ---
BACKUP_STAGE="pre_check"
echo "[backup] stage=$BACKUP_STAGE: ensure local dirs and verify postgres reachable"
mkdir -p "$BACKUP_LOCAL_DIR/daily" "$BACKUP_LOCAL_DIR/weekly" "$BACKUP_LOCAL_DIR/monthly"

# postgres container の readiness を pg_isready で確認 (-T で TTY 不在エラー回避)。
# docker compose は repo root から呼ぶ前提 (compose file の相対 path 解決)。
cd "$KAGETRA_REPO_ROOT"
if ! docker compose -f docker/docker-compose.prod.yml exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null; then
  echo "ERROR: postgres container is not ready (pg_isready failed)" >&2
  exit 1
fi
echo "[backup] postgres ready"

# --- stage 2: pg_dump ---
BACKUP_STAGE="pg_dump"
DAILY_FILE="$BACKUP_LOCAL_DIR/daily/kagetra-${TS}.dump"
echo "[backup] stage=$BACKUP_STAGE: dumping to $DAILY_FILE"

# -Fc: custom (zlib 圧縮済、pg_restore 専用 binary 形式)。重複圧縮しない (-Z 9 禁止)。
# --no-owner --no-acl: restore 先の role が違っても通るようにする (Phase D restore 想定)。
# -T (no TTY): docker compose exec の TTY 不在エラー回避必須。
# stdout を local file に redirect。途中失敗時の半端 file は次回 mtime 古い側で rotation で削除される。
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl \
  > "$DAILY_FILE"

# size check: 1KB 未満なら明らかに失敗 (pg_dump はエラーでも stdout を閉じるため
# bash の pipe exit code だけでは検知漏れる)。
SIZE=$(stat -c%s "$DAILY_FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: pg_dump produced suspiciously small file: $DAILY_FILE ($SIZE bytes)" >&2
  exit 1
fi
echo "[backup] pg_dump complete: $DAILY_FILE ($SIZE bytes)"

# --- stage 3: r2_upload_daily ---
BACKUP_STAGE="r2_upload_daily"
# copyto: src を dst path に rename copy する (copy だと src dirname を保つ)。
# 同一日 (再実行) は上書きされる。retries/timeout は RCLONE_OPTS で制御済。
DAILY_R2_PATH="R2:${R2_BUCKET}/daily/kagetra-${DATE_JST}.dump"
echo "[backup] stage=$BACKUP_STAGE: uploading to $DAILY_R2_PATH"
rclone copyto "${RCLONE_OPTS[@]}" "$DAILY_FILE" "$DAILY_R2_PATH"
echo "[backup] r2 upload (daily) complete"

# --- stage 4: weekly_promote ---
BACKUP_STAGE="weekly_promote"
if [ "$DOW" = "7" ]; then
  WEEKLY_FILE="$BACKUP_LOCAL_DIR/weekly/kagetra-${DATE_JST}.dump"
  WEEKLY_R2_PATH="R2:${R2_BUCKET}/weekly/kagetra-${DATE_JST}.dump"
  echo "[backup] stage=$BACKUP_STAGE: DOW=7 (Sun), promoting to weekly"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  rclone copyto "${RCLONE_OPTS[@]}" "$WEEKLY_FILE" "$WEEKLY_R2_PATH"
  echo "[backup] weekly promote complete: $WEEKLY_FILE → $WEEKLY_R2_PATH"
else
  echo "[backup] stage=$BACKUP_STAGE: DOW=$DOW (not Sun), skipping"
fi

# --- stage 5: monthly_promote ---
BACKUP_STAGE="monthly_promote"
if [ "$DOM" = "01" ]; then
  MONTHLY_FILE="$BACKUP_LOCAL_DIR/monthly/kagetra-${DATE_JST}.dump"
  MONTHLY_R2_PATH="R2:${R2_BUCKET}/monthly/kagetra-${DATE_JST}.dump"
  echo "[backup] stage=$BACKUP_STAGE: DOM=01, promoting to monthly"
  cp "$DAILY_FILE" "$MONTHLY_FILE"
  rclone copyto "${RCLONE_OPTS[@]}" "$MONTHLY_FILE" "$MONTHLY_R2_PATH"
  echo "[backup] monthly promote complete: $MONTHLY_FILE → $MONTHLY_R2_PATH"
else
  echo "[backup] stage=$BACKUP_STAGE: DOM=$DOM (not 01), skipping"
fi

# --- stage 6: rotation_local ---
BACKUP_STAGE="rotation_local"
echo "[backup] stage=$BACKUP_STAGE: pruning local tiers (daily=7d, weekly=56d, monthly=365d)"
# -mtime +N: N 日より「古い」file を対象。-maxdepth 1 で sub-dir に潜らない。
# -type f + -name '*.dump' で .dump 以外には触らない (操作ミス防止)。
find "$BACKUP_LOCAL_DIR/daily"   -maxdepth 1 -type f -name '*.dump' -mtime +7   -delete
find "$BACKUP_LOCAL_DIR/weekly"  -maxdepth 1 -type f -name '*.dump' -mtime +56  -delete
find "$BACKUP_LOCAL_DIR/monthly" -maxdepth 1 -type f -name '*.dump' -mtime +365 -delete
echo "[backup] local rotation complete"

# --- stage 7: rotation_r2 ---
BACKUP_STAGE="rotation_r2"
echo "[backup] stage=$BACKUP_STAGE: pruning R2 tiers (daily=7d, weekly=8w=56d, monthly=12M=365d)"
# rclone delete --min-age: object の mtime が N 経過しているものを削除。
# bucket-level prefix で限定 (/daily, /weekly, /monthly)、tier 越境削除を避ける。
rclone delete "${RCLONE_OPTS[@]}" "R2:${R2_BUCKET}/daily/"   --min-age 7d
rclone delete "${RCLONE_OPTS[@]}" "R2:${R2_BUCKET}/weekly/"  --min-age 8w
rclone delete "${RCLONE_OPTS[@]}" "R2:${R2_BUCKET}/monthly/" --min-age 12M
echo "[backup] r2 rotation complete"

# --- 完了 ---
BACKUP_STAGE="done"
echo "[backup] all stages completed successfully (ts=$TS, dow=$DOW, dom=$DOM)"

# === 設計判断メモ ===
# tsx 呼び出し: PATH 解決ではなく ${KAGETRA_REPO_ROOT}/apps/mail-worker/node_modules/.bin/tsx
# 絶対 path 採用。理由: 本番 systemd unit は minimal PATH (/usr/bin:/bin) で起動するため、
# pnpm 経由で配置された node_modules/.bin が PATH に乗らない。global tsx を強制すると
# pnpm install で入る version と乖離するリスクもあり、worktree-local の bin を使う方が堅い。
