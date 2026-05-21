# apps/web (Next.js 15 standalone) デプロイ手順

kagetra_new フロントエンド (Next.js 15 App Router) を Oracle Cloud
Ubuntu 22.04 上に systemd service として起動する手順。Next.js standalone
output を `apps/web/.next/standalone/` から起動、port 3000 で nginx が
reverse proxy する。

## 0. 前提

- Phase A 完了 (`docs/deploy/oracle-setup.md` / `docs/deploy/dns-ssl.md`)
- `docs/deploy/postgres.md` 完了 (PostgreSQL 起動 + migration 適用済)
- Node 22 + corepack pnpm 9.x install 済 (`oracle-setup.md` §6)
- `kagetra` user + `/opt/kagetra` 準備済 (`mail-worker.md` §1 と同じ)
- `.env.production` 配置済 (`postgres.md` §0 参照)

## 1. git clone (まだなら)

```bash
# mail-worker と同じ /opt/kagetra に clone 済の前提。未 clone なら:
sudo -u kagetra git clone https://github.com/poponta2020/kagetra_new.git /opt/kagetra
```

## 2. pnpm install

```bash
cd /opt/kagetra
sudo -u kagetra corepack pnpm install --frozen-lockfile
```

## 3. build

```bash
sudo -u kagetra corepack pnpm --filter @kagetra/web build
```

- Next.js standalone は `apps/web/.next/standalone/` に出力される
- monorepo 構造が反映され、`apps/web/.next/standalone/apps/web/server.js`
  がエントリーポイント

## 4. 静的アセット コピー (最重要、忘れると CSS/JS 全部 404)

```bash
# Next.js standalone は public/ と .next/static/ をコピーしない仕様。手動 cp 必須。
# cp 先 path は monorepo path を踏襲: .next/standalone/apps/web/.next/static/
# (apps/web に public/ ディレクトリが存在しない場合は public/ の cp は不要)
sudo -u kagetra cp -r /opt/kagetra/apps/web/.next/static /opt/kagetra/apps/web/.next/standalone/apps/web/.next/

# public/ がある場合は追加で:
# sudo -u kagetra cp -r /opt/kagetra/apps/web/public /opt/kagetra/apps/web/.next/standalone/apps/web/
```

**これを忘れると next start は起動するが画面が全部真っ白になる**
(server.js は port 3000 で listen するが、`/_next/static/*` と `/public/*`
の応答が全部 404 になり、HTML だけ返って CSS/JS が読み込まれない)。

> 2026-05-21 初回デプロイ時点では `apps/web/public/` ディレクトリは存在しない
> (favicon 等の静的ファイルは `src/app` 配下 or `.next/static` 経由で配信)。
> 将来 public/ を追加した場合は上記コマンド行の comment-out を外す。

## 5. systemd unit 配置 + enable

```bash
sudo cp /opt/kagetra/apps/web/systemd/kagetra-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-web.service
sudo systemctl status kagetra-web.service
```

## 6. nginx config 設置

```bash
# certbot --nginx で /etc/nginx/sites-enabled/default に SSL 設定済。これを上書き。
sudo cp /opt/kagetra/docker/nginx/kagetra.conf.example /etc/nginx/sites-available/kagetra
sudo ln -sf /etc/nginx/sites-available/kagetra /etc/nginx/sites-enabled/kagetra
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t  # syntax check
sudo systemctl reload nginx
```

## 7. 動作確認

```bash
# local の port 3000 が応答すること
curl -I http://127.0.0.1:3000
# nginx 経由で 200 が返ること
curl -I https://new.hokudaicarta.com
# journalctl で web service のログ
sudo journalctl -u kagetra-web.service -n 50 --no-pager
```

## 8. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| curl 127.0.0.1:3000 で connection refused | systemd service 起動失敗、`journalctl -u kagetra-web.service -n 100` で詳細 |
| 画面が真っ白、F12 で CSS/JS 404 | §4 静的アセット cp 忘れ、再度 cp して `sudo systemctl restart kagetra-web.service` |
| `Cannot find module 'next'` | standalone build 失敗 or transpilePackages 設定不整合、build を pnpm clean 後やり直し |
| nginx 502 Bad Gateway | apps/web (3000) が応答していない、`systemctl status kagetra-web.service` / `journalctl -u kagetra-web.service` で確認 |
| Auth.js LINE Login で redirect URI mismatch | LINE Developers Console の callback URL が `https://new.hokudaicarta.com/api/auth/callback/line` (Auth.js login) + `https://new.hokudaicarta.com/api/line-link/callback` (self-identify) の **両方** 登録済か確認 |
| `https://new.hokudaicarta.com/` → `/auth/signin` → `/` の無限 redirect ループ (ブラウザで `ERR_TOO_MANY_REDIRECTS`) | `.env.production` に `AUTH_TRUST_HOST=true` が設定されていない。Auth.js v5 は nginx 等の reverse proxy 配下では `AUTH_TRUST_HOST` を明示しないと `X-Forwarded-Proto` を信頼せず redirect logic が崩壊する。`.env.production.example` を参照し、追記後 `sudo systemctl restart kagetra-web.service` |
