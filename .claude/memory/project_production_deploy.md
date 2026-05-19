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
- **Phase C**: バックアップ配線 — 未着手
  - pg_dump → R2 + LINE 失敗通知 + 家 PC 副 copy + 復元 doc
- **Phase D**: 本番初回起動 + 動作確認 + ship — 未着手
  - initial-launch-checklist.md で 10 項目消化

## ドメイン cutover (将来別 PR)

Phase 4 完了 + データ移行完了後に `new.hokudaicarta.com` → root `hokudaicarta.com` に統一する cutover を別 PR で実施。LINE Login channel の redirect URI を段階移行 (`new.` と root 並行 → root のみ)。本デプロイ計画のスコープ外。

## Phase B 学び

- **Hono basePath が `/api` だと Auth.js の `/api/auth/*` と衝突** — nginx で `/api/* → Hono 3001` にすると Auth.js callback が 404 する。**Hono を `/hono-api/*` に分離** (Option B) で nginx config は 2 location でシンプルに済む (PR #33 で実装、PR #32 R3 Codex 警告を解消)
- **Next.js 15 standalone monorepo は `outputFileTracingRoot` で監視 path を確定** — pnpm workspace + transpilePackages で `.next/standalone/apps/web/server.js` 構造になる
- **静的アセット cp が最頻発罠** — `.next/static` と `public/` は standalone copy 対象外、別途 cp 必須、忘れると画面真っ白
- **drizzle-kit migrate は本番不適** — TTY 必須なので CI/本番では使えない。psql + SHA-256 hash 計算 + `drizzle.__drizzle_migrations` 手動 INSERT で代替 (apply-migrations.sh)
- **Codex R1 一発 pass は珍しい** — 通常は R2-R3 で nits 残るが、PR #33 は事前の subagent verification (17/17 仕様 + 35/35 anti-pattern) で密度が高かったため一発で済んだ

## Phase A 学び

- **Codex は doc PR でも phase 横断の整合性指摘を出す** — PR #32 R3 で Phase B nginx 設計の Auth.js callback routing 警告が出た。Phase A doc 単独では実害ゼロでも、Phase B 着手前に doc に注意を反映できたのは利得
- **OCI Security List のポート指定** — カンマ区切り (`80,443`) は受け付けられない可能性があり、80 と 443 を別ルールで 2 件追加が安全 (PR #32 R2)
- **certbot --nginx は標準で HSTS を付けない** — HSTS が欲しければ nginx に `add_header Strict-Transport-Security ... always;` 明示追加が必要 (PR #32 R1)
