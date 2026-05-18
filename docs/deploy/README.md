# kagetra_new デプロイドキュメント index

kagetra_new を Oracle Cloud Always Free (Tokyo) 上に本番デプロイする手順。
Phase A-D の段階構成で進める。

## 読む順序

| Phase | doc | 概要 |
|---|---|---|
| A | `oracle-setup.md` | Oracle Cloud アカウント作成 → Tokyo ARM A1 インスタンス起動 → iptables/swap/user/Node/Docker セットアップ |
| A | `dns-ssl.md` | お名前.com で `new.hokudaicarta.com` A レコード追加 → nginx → Let's Encrypt SSL |
| B | `postgres.md` (今後追加) | Docker Compose で PostgreSQL 16 起動 + migration 適用 + 接続確認 |
| B | `web.md` (今後追加) | apps/web (Next.js standalone) を systemd service として起動 |
| B | `api.md` (今後追加) | apps/api (Hono) を systemd service として起動 |
| P3-A 既存 | `mail-worker.md` | apps/mail-worker (cron 30 分) を systemd timer で起動 (既存) |
| C | `backup-restore.md` (今後追加) | pg_dump → Cloudflare R2 日次バックアップ + 復元手順 |
| D | `initial-launch-checklist.md` (今後追加) | 全 Phase 揃った後の初回起動・動作確認チェックリスト |

## Phase 構成

- **Phase A** (現在): インフラ準備 + 手動セットアップ doc のみ (コード
  変更なし)
- **Phase B**: アプリケーションデプロイ配線 (systemd unit /
  docker-compose.prod.yml / nginx 設定 / migration script / 初期 admin
  seed)
- **Phase C**: バックアップ配線 (pg_dump → R2 + LINE 失敗通知 + 復元手順)
- **Phase D**: 本番初回起動 + 動作確認 + ship

## 確定済み構成

| 項目 | 値 |
|---|---|
| インフラ | Oracle Cloud Always Free 東京 (ARM Ampere A1, 4 OCPU / 24GB RAM / 200GB SSD) |
| OS | Ubuntu 22.04 LTS (aarch64) |
| ドメイン | `new.hokudaicarta.com` (サブドメイン分離、root は旧 kagetra 並行稼働) |
| DNS | お名前.com (移管しない) |
| SSL | Let's Encrypt (certbot, 自動更新) |
| reverse proxy | nginx (port 80/443 → web 3000 デフォルト、Hono API は別 path prefix or 別サブドメインで分離 — Phase B で詳細設計) |
| 認証経路の注意 | LINE Login の redirect URI は `/api/auth/callback/line` で Next.js (web 3000) の Auth.js App Router が処理する。Phase B で `/api/*` を Hono (api 3001) に全部流すと Auth.js callback が壊れるため、`/api/auth/*` は明示的に web 3000 にルートする (or Hono を `/hono-api/*` 等に分離) |
| DB | PostgreSQL 16 (Docker 同居、localhost bind) |
| バックアップ | Cloudflare R2 (10GB 無料 tier, 日次 03:00 JST + GFS rotation) |
| LINE Login (production) | 新規取得 (redirect URI: `https://new.hokudaicarta.com/api/auth/callback/line`) |
| LINE Bot (mail-worker 通知) | dev 流用 (notification userId のみ差し替え) |

## 未スコープ (将来別 PR)

- 自動デプロイ (GitHub Actions CD) — v1 は手動 deploy
- 監視ツール (Datadog 等) — v1 は journalctl + LINE 通知のみ
- 旧 kagetra からのデータ移行 — Phase 4 完了 + 本番安定確認後に別 PR で
  実施
- 写真アルバム (Phase 4) のオブジェクトストレージ移行検討 — 議論先送り
- ドメイン cutover (`new.hokudaicarta.com` → root `hokudaicarta.com` 統一)
  — データ移行完了後に別 PR
