#!/usr/bin/env bash
#
# 本番ホスト (Oracle Cloud) 上で実行する自動デプロイスクリプト。
# GitHub Actions の deploy job が `ssh kagetra@host 'bash -s' < このファイル` で
# 流し込む。kagetra ユーザー (=/opt/kagetra 所有) として実行される前提。
#
# 安全策:
#   - 追跡対象のローカル変更があれば中断 (ホスト側の手当てを壊さない)
#   - 変更が docs/.claude 等のみなら build/restart をスキップ (無駄な再起動回避)
#   - build 成功後にのみ restart (build 失敗時は全サービス旧コードのまま継続)
#   - restart 後に healthcheck
#
# 権限: git/build/cp は kagetra が直接実行 (所有者)。systemctl restart のみ
#       /etc/sudoers.d/kagetra-deploy で web/api に限定して NOPASSWD 許可。
set -uo pipefail

REPO=/opt/kagetra
log()  { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
fail() { echo "[deploy ERROR] $*" >&2; echo "DEPLOY_RESULT=FAILED"; exit 1; }

cd "$REPO" || fail "cannot cd to $REPO"

# 追跡対象のローカル変更があれば中断。未追跡 (.cache/.config/.local 等の
# corepack/pnpm キャッシュ) は fetch/checkout と衝突しないので無視。
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  fail "tracked local changes present on host — aborting"
fi

OLD=$(git rev-parse HEAD)
log "before: $(git rev-parse --short HEAD)"
git fetch origin main -q || fail "git fetch failed"
NEW=$(git rev-parse origin/main)
if [ "$OLD" = "$NEW" ]; then
  log "already up to date ($(git rev-parse --short HEAD))"
  echo "DEPLOY_RESULT=NOOP"; exit 0
fi

CHANGED=$(git diff --name-only "$OLD" "$NEW")
git checkout -B main origin/main -q || fail "git checkout failed"
log "after: $(git rev-parse --short HEAD)"

# 変更パスから対象アプリを判定 (packages/ 変更は全アプリに波及)
if echo "$CHANGED" | grep -qE '^packages/'; then SHARED=1; else SHARED=0; fi
if [ "$SHARED" = 1 ] || echo "$CHANGED" | grep -qE '^apps/web/';         then WEB=1;    else WEB=0;    fi
if [ "$SHARED" = 1 ] || echo "$CHANGED" | grep -qE '^apps/api/';         then API=1;    else API=0;    fi
if [ "$SHARED" = 1 ] || echo "$CHANGED" | grep -qE '^apps/mail-worker/'; then WORKER=1; else WORKER=0; fi

if [ "$WEB$API$WORKER" = "000" ]; then
  log "no buildable code changed (docs/.claude/scripts only) — skipping build & restart"
  echo "DEPLOY_RESULT=SKIPPED_NOCODE"; exit 0
fi
log "targets: web=$WEB api=$API worker=$WORKER (shared=$SHARED)"

corepack pnpm install --frozen-lockfile || fail "pnpm install failed"

# NEXT_PUBLIC_* は Next.js の build 時にクライアントバンドルへ inline される。
# .env.production は systemd EnvironmentFile (実行時) なので build には自動で渡らない。
# VAPID 公開鍵 (NEXT_PUBLIC_VAPID_PUBLIC_KEY) などデフォルト値の無い公開 env を
# クライアントへ焼き込むため、NEXT_PUBLIC_ 行だけ抽出して export してから build する。
# (NEXT_PUBLIC_API_URL は api.ts 側に `?? '/hono-api'` デフォルトがあり従来 inline
#  されていなくても動作したが、VAPID 公開鍵はデフォルトが無く inline 必須。)
if [ -f /opt/kagetra/.env.production ]; then
  set -a; . <(grep -E '^NEXT_PUBLIC_[A-Za-z0-9_]+=' /opt/kagetra/.env.production); set +a
fi

# --- build (失敗時は restart 前に中断 → 全サービス旧コード継続) ---
if [ "$WEB" = 1 ];    then log "build apps/web";         corepack pnpm --filter @kagetra/web build         || fail "web build failed (no restart performed)"; fi
if [ "$API" = 1 ];    then log "build apps/api";         corepack pnpm --filter @kagetra/api build         || fail "api build failed (no restart performed)"; fi
if [ "$WORKER" = 1 ]; then log "build apps/mail-worker"; corepack pnpm --filter @kagetra/mail-worker build || fail "mail-worker build failed (no restart performed)"; fi

# --- apps/web 静的アセット cp (最重要、忘れると CSS/JS 全 404) ---
if [ "$WEB" = 1 ]; then
  STATIC_SRC="$REPO/apps/web/.next/static"
  STATIC_DEST="$REPO/apps/web/.next/standalone/apps/web/.next"
  [ -d "$STATIC_SRC" ] || fail "web static dir missing after build"
  rm -rf "$STATIC_DEST/static"
  cp -r "$STATIC_SRC" "$STATIC_DEST/" || fail "web static cp failed"
  if [ -d "$REPO/apps/web/public" ]; then
    cp -r "$REPO/apps/web/public" "$REPO/apps/web/.next/standalone/apps/web/" || fail "web public cp failed"
  fi
  log "web static assets copied"
fi

# --- DB migration (drizzle の SQL が変わったときのみ、restart 前に適用) ---
# 既存の冪等 apply-migrations.sh (journal+hash で適用済みは skip)。追加系
# migration は restart 前適用で「新コードが新 schema に出会える」順序になる。
# 失敗時は restart せず中断 → 旧コード+旧 schema のまま整合が保たれる。
if echo "$CHANGED" | grep -qE '^packages/shared/drizzle/[0-9].*\.sql$'; then
  log "DB migration(s) changed — applying via apply-migrations.sh (idempotent)"
  ENVFILE=/opt/kagetra/.env.production
  [ -f "$ENVFILE" ] || fail "env file not found: $ENVFILE"
  # DATABASE_URL を抽出 (前後の引用符は除去)。env ファイル全体は source しない
  # (systemd EnvironmentFile 形式は bash の . で壊れ得るため)。
  DB_URL=$(grep -E '^DATABASE_URL=' "$ENVFILE" | head -1 | sed -E "s/^DATABASE_URL=//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/")
  [ -n "$DB_URL" ] || fail "DATABASE_URL not found in $ENVFILE"
  DATABASE_URL="$DB_URL" bash "$REPO/scripts/deploy/apply-migrations.sh" || fail "migration apply failed (no restart performed)"
  log "migrations applied"
fi

# --- restart (build 成功後のみ到達)。mail-worker は oneshot+timer なので
#     次回 timer 発火で新バンドルが走る → restart 不要 ---
if [ "$WEB" = 1 ]; then sudo -n systemctl restart kagetra-web.service || fail "web restart failed"; fi
if [ "$API" = 1 ]; then sudo -n systemctl restart kagetra-api.service || fail "api restart failed"; fi

sleep 4
if [ "$WEB" = 1 ]; then
  [ "$(sudo -n systemctl is-active kagetra-web.service)" = active ] || fail "web service not active after restart"
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3000 || echo "000")
  log "web healthcheck http://127.0.0.1:3000 -> $CODE"
  case "$CODE" in 2*|3*) ;; *) fail "web healthcheck got HTTP $CODE" ;; esac
fi
if [ "$API" = 1 ]; then
  [ "$(sudo -n systemctl is-active kagetra-api.service)" = active ] || fail "api service not active after restart"
fi

log "deployed HEAD: $(git rev-parse --short HEAD)"
echo "DEPLOY_RESULT=SUCCESS"
