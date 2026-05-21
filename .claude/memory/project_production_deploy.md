---
name: 本番デプロイ計画 (Phase A-D)
description: kagetra_new 本番デプロイの確定方針 (Oracle Cloud Always Free + new.hokudaicarta.com + Cloudflare R2 backup) と Phase A-D の進行状況
type: project
originSessionId: 3f76d005-46db-4156-9528-6f86bd7f4da1
---
# 本番デプロイ計画 (Phase A-D)

旧 kagetra との並行稼働を前提とする本番デプロイ。2026-05-18 セッションで方針確定 + Phase A (PR #32) ship。

## 確定済み構成

| 項目 | 決定 |
|---|---|
| インフラ | Oracle Cloud Always Free 東京 (ARM Ampere A1 4 OCPU / 24GB RAM / 200GB SSD) |
| OS | Ubuntu 22.04 LTS (aarch64) |
| ドメイン | `new.hokudaicarta.com` (サブドメイン分離) |
| DNS | お名前.com (移管しない) — 旧 kagetra の root レコードを触らないため |
| Cloudflare | R2 用途のみ (DNS 機能未使用) |
| SSL | Let's Encrypt (certbot, 自動更新) |
| reverse proxy | nginx (port 80/443 → web 3000 / `/api/auth/*` は web で Auth.js 処理、それ以外 API は Hono 3001 を別 path or サブドメインで分離) |
| DB | PostgreSQL 16 (Docker 同居、`127.0.0.1:5432` バインド) |
| migration 適用 | `psql -v ON_ERROR_STOP=1 -f migrations/*.sql` (drizzle-kit migrate は TTY 必須で本番不適) |
| バックアップ | Cloudflare R2 (10GB free)、日次 03:00 JST + GFS rotation (日次 7 / 週次 8 / 月次 12)、暗号化なし、副 copy = 家 PC 月次 |
| backup 失敗通知 | mail-worker の system_channel 流用 LINE 通知 |
| LINE Login (production) | 新規取得 (redirect URI `https://new.hokudaicarta.com/api/auth/callback/line`) |
| LINE Bot (mail-worker 通知) | dev 流用 (notification userId のみ差し替え) |
| 初期 admin | SQL で `isInvited=true, role=admin, lineUserId=null` 行を INSERT → LINE 経由 self-identify → claimMemberIdentity |
| 自動デプロイ | v1 は手動 (CD は scope 外) |
| 監視 | v1 は journalctl + LINE 通知のみ |

**Why**: コスト最優先 (1人趣味プロジェクト) でユーザーが Lightsail を却下、調査の結果 Oracle Always Free の 24GB RAM/200GB SSD/東京 region が圧倒的コスパ。リスク (アカウント停止) は R2 backup + 家 PC 副 copy で軽減。

**How to apply**: 各 Phase 着手時に上記構成を所与として進める。設計議論を再起しない。Phase B/C/D の make-plan/do は本 memory を前提に組む。

## Phase 進行

- **Phase A**: インフラ準備 + 手動セットアップ doc 化 — **2026-05-18 PR #32 ship 完了**
  - 新規 doc 3 本: oracle-setup.md / dns-ssl.md / README.md
  - 実機セットアップ (Oracle アカウント作成、ARM A1 起動、DNS 設定、nginx + SSL) は **ユーザー手動実施待ち**、Phase D で動作確認
- **Phase B**: アプリケーションデプロイ配線 — **2026-05-19 PR #33 ship 完了** (Codex R1 一発 pass)
  - Hono basePath を `/api` → `/hono-api` に変更 (Auth.js callback と path 衝突回避、Option B)
  - 配線 4 本: kagetra-web.service / kagetra-api.service / docker-compose.prod.yml (postgres 127.0.0.1 bind) / nginx kagetra.conf.example
  - Operation script 2 本: apply-migrations.sh (psql + SHA-256 hash + drizzle.__drizzle_migrations idempotent INSERT) / seed-initial-admin.ts (3 状態 idempotent + 5 ケース vitest)
  - Env テンプレ 3 + doc 3 (postgres.md / web.md / api.md) + README.md 更新
  - **罠系明示**: 静的アセット cp (.next/static + public/)、postgres localhost bind、drizzle-kit migrate が TTY 必須で本番不適
- **Phase C**: バックアップ配線 — **2026-05-21 PR #34 ship 完了** (4R: 3 auto + 1 manual verify)
  - `scripts/deploy/backup.sh` (7-stage: pre_check → pg_dump → r2_upload → weekly/monthly promote → rotation_local/r2)
  - LINE 失敗通知 2 段構え:
    - primary `notify-system.ts` (DB-backed system_channel、postgres 健全時)
    - fallback `notify-fallback.ts` (env-backed `LINE_FALLBACK_*`、postgres 障害時の唯一の通知経路)
  - systemd unit: `kagetra-backup.{service,timer}` (Type=oneshot, OnCalendar=*-*-* 03:00:00 Asia/Tokyo inline TZ, Persistent=true)
  - GFS rotation: daily=7d / weekly=8w / monthly=12M, local find -mtime + R2 rclone delete --min-age
  - 罠系防御: umask 077 + chmod 600 (dump 漏洩防止)、pg_isready 5 分 retry (catch-up race 回避)、ERR trap 経由の通知 (`fail()` helper で `exit 1` の trap 無効化罠を回避)
  - 家 PC 副 copy 運用は doc のみ (月次手動)、自動化は将来別 PR
- **Phase D**: 本番初回起動 + 動作確認 + ship — **2026-05-21 配線完了、popon admin login 成功**
  - **本番稼働中**: `https://new.hokudaicarta.com` (Oracle Cloud / Ubuntu 22.04 aarch64 / `140.238.51.41`)
  - 手動デプロイ中に発覚した 3 hot fix を ship:
    - PR #35: `apply-migrations.sh` psql 14 stdin substitution (`-c "...:'VAR'..."` 不動作)
    - PR #36: `apps/api` tsup config で `noExternal: ["@kagetra/shared"]` 追加 (workspace dep の bundle 化)
    - PR #37: doc 4 件不整合 (Lightsail DNS / iptables 行番号 / public/ なし / AUTH_TRUST_HOST 不足)
  - admin seed: `popon` <poponta2020@gmail.com> grade=A、LINE 紐付け済 (line_link_method=self_identify)
  - **未完了**: Phase C backup の R2 token 設定 + 実起動 / initial-launch-checklist.md ベース動作確認 / ship 宣言

## ドメイン cutover (将来別 PR)

Phase 4 完了 + データ移行完了後に `new.hokudaicarta.com` → root `hokudaicarta.com` に統一する cutover を別 PR で実施。LINE Login channel の redirect URI を段階移行 (`new.` と root 並行 → root のみ)。本デプロイ計画のスコープ外。

## Phase B 学び

- **Hono basePath が `/api` だと Auth.js の `/api/auth/*` と衝突** — nginx で `/api/* → Hono 3001` にすると Auth.js callback が 404 する。**Hono を `/hono-api/*` に分離** (Option B) で nginx config は 2 location でシンプルに済む (PR #33 で実装、PR #32 R3 Codex 警告を解消)
- **Next.js 15 standalone monorepo は `outputFileTracingRoot` で監視 path を確定** — pnpm workspace + transpilePackages で `.next/standalone/apps/web/server.js` 構造になる
- **静的アセット cp が最頻発罠** — `.next/static` と `public/` は standalone copy 対象外、別途 cp 必須、忘れると画面真っ白
- **drizzle-kit migrate は本番不適** — TTY 必須なので CI/本番では使えない。psql + SHA-256 hash 計算 + `drizzle.__drizzle_migrations` 手動 INSERT で代替 (apply-migrations.sh)
- **Codex R1 一発 pass は珍しい** — 通常は R2-R3 で nits 残るが、PR #33 は事前の subagent verification (17/17 仕様 + 35/35 anti-pattern) で密度が高かったため一発で済んだ

## Phase C 学び

- **bash `set -e` + `if !` + `exit 1` で ERR trap は発火しない** — 「`if !` で捕捉した失敗」も「明示 `exit 1`」も両方 set -e の対象外。`fail() { echo >&2; return 1; }` を定義して `cmd || fail "..."` パターンに統一すれば、`fail` の return 1 が top-level の simple command failure として ERR trap を発火させられる (PR #34 R2 で Codex 指摘 → R3 verify)
- **DB-backed 失敗通知は postgres 障害時に機能しない** — `pushSystemNotification` 系は `line_channels` を DB から読むため、最も通知したい postgres down 時に通知不能。env-var fallback CLI (`notify-fallback.ts`) を別途用意して 2 段構えにする (PR #34 R3 指摘で追加)
- **systemd `[Unit] Requires=service` を timer に付けると enable --now で即発火** — `systemctl enable --now <timer>` で `Requires=` の対象 unit も start され、`OnCalendar` 外で意図しない実行が走る。timer と service の関連付けは `[Timer] Unit=` だけで十分 (PR #34 R1 指摘で削除)
- **`Persistent=true` の catch-up + 単発 pg_isready は race** — boot 後の missed firing catch-up で docker daemon は起動済でも postgres container がまだ初期化中。1 回の `pg_isready` で当日分が落ちる。`for i in $(seq 1 60); do pg_isready ... && break; sleep 5; done` で最大 5 分 retry (PR #34 R3 で追加)
- **pg_dump `-Fc` は既に zlib 圧縮済** — `gzip` pipe や `-Z 9` で重複圧縮しない。output 拡張子は `.dump` (community 標準)
- **rclone R2 で Object Read & Write token は ListBuckets 不可** — `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` を export して HeadBucket を skip しないと bucket-exists check で失敗
- **R2 endpoint は HTTP 不可、`endpoint=http://...` で 400** — `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` を明示
- **dump ファイル permission は umask + chmod の二重防御** — umask 077 だけだと既存 dir の mode は変わらない。`install -d -m 0700` で dir 強制、`chmod 600 "$DAILY_FILE"` で file 強制 (PR #34 R2)

## Phase D (本番初回デプロイ) 学び (2026-05-21)

- **`hokudaicarta.com` の DNS は AWS Lightsail DNS zone** — 旧 kagetra が Lightsail 運用、お名前.com Navi の「DNS 設定/転送設定」では追加できない (NXDOMAIN で 30 分浪費)。詳細は [[reference_legacy_kagetra_infra]]
- **psql 14 の `-c "SQL with :'VAR'"` substitution は動かない** — stdin 経由 (`<<'EOSQL'`) は動く。`postgresql-client-14` (Ubuntu 22.04 default) で踏む。PR #35 で apply-migrations.sh 修正済
- **tsup default は workspace dep を external 扱い** — `@kagetra/shared` の exports が `.ts` を指していると本番 node が `.ts` を読みに行き、relative import の拡張子不足で ERR_MODULE_NOT_FOUND。`noExternal: ["@kagetra/shared"]` で bundle 化必須。PR #36 で修正済
- **Auth.js v5 + nginx reverse proxy では `AUTH_TRUST_HOST=true` 必須** — 未設定だと `/` → `/auth/signin` → `/` 無限ループ (ブラウザに `ERR_TOO_MANY_REDIRECTS`)。dev (localhost) では auto-trust されるため発覚しない。PR #37 で `.env.production.example` に追記済
- **Oracle Ubuntu 22.04 fresh image の REJECT は line 5、line 6 ではない** — `-I INPUT 6` だと挿入が REJECT より後ろになって弾かれる。`iptables -L INPUT --line-numbers` で REJECT 位置 N を事前確認し `-I INPUT N` で挿入。PR #37 で oracle-setup.md 修正済
- **apps/web は public/ ディレクトリなし** (2026-05 時点) — favicon 等は `src/app` or `.next/static` 経由。web.md の `cp -r apps/web/public` ステップは現状不要。PR #37 で comment-out 化
- **Codex R1 一発 pass は連続できる** — PR #33 + #35 + #36 + #37 で連続 R1 pass、合計 ~125k tokens。事前検証 + small scope + clear root cause description が効く

## Phase A 学び

- **Codex は doc PR でも phase 横断の整合性指摘を出す** — PR #32 R3 で Phase B nginx 設計の Auth.js callback routing 警告が出た。Phase A doc 単独では実害ゼロでも、Phase B 着手前に doc に注意を反映できたのは利得
- **OCI Security List のポート指定** — カンマ区切り (`80,443`) は受け付けられない可能性があり、80 と 443 を別ルールで 2 件追加が安全 (PR #32 R2)
- **certbot --nginx は標準で HSTS を付けない** — HSTS が欲しければ nginx に `add_header Strict-Transport-Security ... always;` 明示追加が必要 (PR #32 R1)
