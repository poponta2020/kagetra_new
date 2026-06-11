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

# 変更パスから対象アプリを判定 (packages/ と pnpm-lock.yaml の変更は全アプリに波及)。
# pnpm-lock.yaml: 依存の追加/更新はアプリのファイルを変えずに各バンドルの内容を
# 変える (例: PR #134 の word-extractor 追加) ため、安全側で全アプリ再ビルドに倒す。
if echo "$CHANGED" | grep -qE '^(packages/|pnpm-lock\.yaml$)'; then SHARED=1; else SHARED=0; fi
# web は @kagetra/mail-worker の TS ソースを transpilePackages で Next.js バンドルに
# 焼き込む (apps/web/next.config.ts)。mail-worker のみの変更でも web の再ビルド+
# 再起動が必須 — Issue #135: PR #134 (mail-worker only) のデプロイが web=0 と判定
# され、本番の再抽出 Server Action が旧 classifier (prompt 2.0.0) のまま残留した。
if [ "$SHARED" = 1 ] || echo "$CHANGED" | grep -qE '^apps/(web|mail-worker)/'; then WEB=1; else WEB=0; fi
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
  # source せず key=value として読み取って export する（右辺を shell 評価しない）。
  # `NEXT_PUBLIC_FOO=$(...)` や `;` を含む値が混ざっても deploy 権限でコマンド実行
  # されないよう、設定ファイルはデータとして扱う（下部の DATABASE_URL 抽出と同方針）。
  while IFS= read -r np_line; do
    np_key=${np_line%%=*}
    np_val=${np_line#*=}
    np_val=${np_val%$'\r'}                     # 末尾 CR 除去
    np_val=${np_val%\"}; np_val=${np_val#\"}   # 両端のダブルクォート除去
    np_val=${np_val%\'}; np_val=${np_val#\'}   # 両端のシングルクォート除去
    export "$np_key=$np_val"
  done < <(grep -E '^NEXT_PUBLIC_[A-Za-z0-9_]+=' /opt/kagetra/.env.production)
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

# --- systemd unit ファイル配置 (kagetra-* の .service/.timer が変わったとき) ---
# Issue #131: PR #127 で新規追加された kagetra-mail-worker-extract.{service,timer}
# が本番に未配置のまま AI 抽出が永遠に待たされた。以降は repo の systemd ユニットが
# 変わったら自動で /etc/systemd/system/ にコピー + daemon-reload + (timer なら enable
# --now / restart) するよう、deploy script 側で吸収する。
#
# 配置は `install -m 644 -o root -g root` で行う (cp+chown+chmod を 1 コマンドで原子化)。
# scoped sudo は infra/sudoers/kagetra-deploy で **固定 unit 名のみ** 列挙する (Codex
# r1 blocker: ワイルドカード `kagetra-*` だと kagetra アカウントが任意 unit を root
# 実行できる privilege escalation を生む)。
#
# 新規 unit を追加する場合は infra/sudoers/kagetra-deploy にも対応エントリを追記し、
# 本番に sudoers を再配置 (docs/deploy/mail-worker.md §1 step 7 参照) してから
# その unit を含む PR をマージする。sudoers 未登録の unit を deploy しても、auto-deploy
# の `install` が sudo に蹴られて即 fail するため安全側に倒れる。
#
# --- Trust model (Codex r3 blocker への明示的な応答) ---
# kagetra ユーザーは /opt/kagetra 配下の unit ファイルに書き込み可能。そのため
# 理論上は「kagetra デプロイ鍵を奪取した攻撃者が unit 内容を改ざんしてから sudo
# install + restart で root 権限の任意コード実行を成立させる」経路が存在する。
# 本リポジトリの信頼境界では:
#   1. main への push 権が = 本番への deploy 認可。1 人開発でその person が
#      root SSH 鍵も保有しているため、escalation の追加リスクは限定的
#   2. それでも下記の defensive check で「典型的な User= 改ざん攻撃」は塞ぐ:
#      .service には `User=kagetra` と `Group=kagetra` が必須。欠落していたら
#      install を拒否する (NoNewPrivileges, Capabilities 等の高度な迂回は防げ
#      ないが、低コスト/低保守で実用的な閾値)
#   3. multi-developer 環境に拡張する場合は root 所有 staging dir + 検収手順
#      (allowlist / sha256 照合) への置き換えを再検討する
#
# daemon-reload は新規 unit を systemd に認識させるのに必須。
# timer は enable で `WantedBy=timers.target` symlink を張り --now で即起動、変更後は
# restart で新スケジュールを再読込する (oneshot service 側は次回発火で新ファイルを読む)。
SYSTEMD_CHANGES=$(echo "$CHANGED" | grep -E '^apps/[^/]+/systemd/kagetra-[^/]+\.(service|timer)$' || true)
if [ -n "$SYSTEMD_CHANGES" ]; then
  log "systemd unit changes detected:"
  echo "$SYSTEMD_CHANGES" | sed 's/^/    /'
  CHANGED_TIMERS=""
  while IFS= read -r unit_path; do
    [ -z "$unit_path" ] && continue
    src="$REPO/$unit_path"
    [ -f "$src" ] || fail "unit source missing after checkout: $src"
    name=$(basename "$unit_path")
    dest="/etc/systemd/system/$name"
    # Defensive check (trust model 2): .service は User=kagetra + Group=kagetra
    # を必須にする。.timer は実行ユーザを持たないので check 不要。改ざんで User=
    # を root に書き換えるタイプの escalation を低コストで弾く。
    case "$name" in
      *.service)
        grep -qE '^User=kagetra$' "$src" \
          || fail "$name does not declare 'User=kagetra' — refusing to install (privilege escalation guard)"
        grep -qE '^Group=kagetra$' "$src" \
          || fail "$name does not declare 'Group=kagetra' — refusing to install"
        ;;
    esac
    log "installing unit: $name"
    sudo -n /usr/bin/install -m 644 -o root -g root "$src" "$dest" \
      || fail "install $name failed (sudoers /etc/sudoers.d/kagetra-deploy 未配置?)"
    case "$name" in *.timer) CHANGED_TIMERS="$CHANGED_TIMERS $name" ;; esac
  done <<< "$SYSTEMD_CHANGES"
  sudo -n /usr/bin/systemctl daemon-reload || fail "systemctl daemon-reload failed"
  for t in $CHANGED_TIMERS; do
    # enable --now: 新規 timer なら有効化+起動。既に有効なら no-op (idempotent)。
    sudo -n /usr/bin/systemctl enable --now "$t" || fail "enable --now $t failed"
    # restart: 既存 timer のスケジュール変更を即時反映 (enable --now だけだと
    # 既に active な timer は再起動されないので OnUnitActiveSec= 等の変更が
    # 次回 active 化まで反映されない)。新規 timer に対しては no-op。
    sudo -n /usr/bin/systemctl restart "$t" || fail "restart $t failed"
    [ "$(sudo -n /usr/bin/systemctl is-active "$t")" = active ] || fail "$t not active after restart"
    log "timer active: $t"
  done
fi

# --- restart (build 成功後のみ到達)。mail-worker は oneshot+timer なので
#     次回 timer 発火で新バンドルが走る → restart 不要 ---
if [ "$WEB" = 1 ]; then sudo -n /usr/bin/systemctl restart kagetra-web.service || fail "web restart failed"; fi
if [ "$API" = 1 ]; then sudo -n /usr/bin/systemctl restart kagetra-api.service || fail "api restart failed"; fi

sleep 4
if [ "$WEB" = 1 ]; then
  [ "$(sudo -n /usr/bin/systemctl is-active kagetra-web.service)" = active ] || fail "web service not active after restart"
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3000 || echo "000")
  log "web healthcheck http://127.0.0.1:3000 -> $CODE"
  case "$CODE" in 2*|3*) ;; *) fail "web healthcheck got HTTP $CODE" ;; esac
fi
if [ "$API" = 1 ]; then
  [ "$(sudo -n /usr/bin/systemctl is-active kagetra-api.service)" = active ] || fail "api service not active after restart"
fi

log "deployed HEAD: $(git rev-parse --short HEAD)"
echo "DEPLOY_RESULT=SUCCESS"
