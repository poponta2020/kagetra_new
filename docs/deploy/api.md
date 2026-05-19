# apps/api (Hono) デプロイ手順

kagetra_new バックエンド API (Hono on Node) を systemd service として
起動する手順。tsup build で `dist/index.js` 生成、port 3001 で待ち受け、
nginx が `/hono-api/*` を proxy_pass する。basePath は `/hono-api`
(Phase B Option B、Phase A R3 Codex 指摘の Auth.js callback 衝突回避)。

## 0. 前提

- Phase A 完了 (`docs/deploy/oracle-setup.md` / `docs/deploy/dns-ssl.md`)
- `docs/deploy/postgres.md` 完了 (PostgreSQL 起動 + migration 適用済)
- `docs/deploy/web.md` §1〜§2 完了想定 (`git clone` + `pnpm install` は
  monorepo 共通)

## 1. build

```bash
cd /opt/kagetra
sudo -u kagetra corepack pnpm --filter @kagetra/api build
```

- tsup で `apps/api/dist/index.js` 生成
- `@kagetra/shared` workspace 依存は `/opt/kagetra/node_modules` で
  resolved される (pnpm の symlink)

## 2. systemd unit 配置 + enable

```bash
sudo cp /opt/kagetra/apps/api/systemd/kagetra-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-api.service
sudo systemctl status kagetra-api.service
```

## 3. 動作確認

```bash
# local の port 3001 で health endpoint が応答すること
curl http://127.0.0.1:3001/hono-api/health
# → {"status":"ok"} が返れば OK
# nginx 経由 (Phase A SSL 完了後):
curl https://new.hokudaicarta.com/hono-api/health
# journalctl
sudo journalctl -u kagetra-api.service -n 50 --no-pager
```

## 4. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| curl `/hono-api/health` で 404 | basePath 設定間違い、`apps/api/src/app.ts` の `app.basePath('/hono-api')` 確認 (Stream 0 で変更済) |
| curl で connection refused | systemd 起動失敗、`journalctl -u kagetra-api.service -n 100` で詳細 |
| `Cannot find module '@kagetra/shared'` | pnpm workspace の symlink が壊れている、`/opt/kagetra/node_modules/@kagetra/shared` を確認、再度 `corepack pnpm install` |
| DATABASE_URL 接続失敗 | `.env.production` の `DATABASE_URL` が正しいか + postgres container 起動済か確認 (`docker compose -f docker/docker-compose.prod.yml ps`) |
