# kagetra_new デプロイドキュメント index

kagetra_new を Oracle Cloud Always Free (Tokyo) 上に本番デプロイする手順。
Phase A-D の段階構成で進める。

## 読む順序

| Phase | doc | 概要 |
|---|---|---|
| A | `oracle-setup.md` | Oracle Cloud アカウント作成 → Tokyo ARM A1 インスタンス起動 → iptables/swap/user/Node/Docker セットアップ |
| A | `dns-ssl.md` | お名前.com で `new.hokudaicarta.com` A レコード追加 → nginx → Let's Encrypt SSL |
| B | [postgres.md](postgres.md) | Docker Compose で PostgreSQL 16 起動 + apply-migrations.sh で migration 適用 + 接続確認 |
| B | [web.md](web.md) | apps/web (Next.js 15 standalone) を systemd service として起動 + 静的アセット cp + nginx 配線 |
| B | [api.md](api.md) | apps/api (Hono) を systemd service として起動、basePath は /hono-api |
| P3-A 既存 | `mail-worker.md` | apps/mail-worker (cron 30 分) を systemd timer で起動 (既存) |
| C | `backup-restore.md` (今後追加) | pg_dump → Cloudflare R2 日次バックアップ + 復元手順 |
| D | `initial-launch-checklist.md` (今後追加) | 全 Phase 揃った後の初回起動・動作確認チェックリスト |

## Phase 構成

- **Phase A**: インフラ準備 + 手動セットアップ doc のみ (コード変更なし)
  — 完了 (PR #32)
- **Phase B** (現在): アプリケーションデプロイ配線 (systemd unit /
  docker-compose.prod.yml / nginx 設定 / migration script / 初期 admin
  seed) — 実装中 (本 PR)
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
| reverse proxy | nginx (port 80/443 → /hono-api/* は api 3001、それ以外は web 3000) |
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
