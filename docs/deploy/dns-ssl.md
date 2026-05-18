# DNS (お名前.com) + nginx + Let's Encrypt SSL

kagetra_new の本番ドメイン `new.hokudaicarta.com` を Oracle Cloud
インスタンスに向け、nginx + Let's Encrypt で HTTPS 化するまでの手順。
お名前.com 取得済の `hokudaicarta.com` を流用し、サブドメイン分離方式で
旧 kagetra (root) と並行稼働する。

## 0. 前提

- ドメイン: `hokudaicarta.com` (お名前.com 取得済)
- 旧 kagetra: root `hokudaicarta.com` で稼働中 → **一切触らない**
- 新システム: `new.hokudaicarta.com` でサブドメイン分離
- DNS 管理: **お名前.com のまま** (移管しない、`new` の A レコードを
  追加するだけ)
- 前提: Oracle インスタンス起動済 + 80/443 が外部から到達可能
  (`oracle-setup.md` §1-§5 完了)
- インスタンス Public IP: Oracle Cloud Console → Instances → 詳細画面で
  確認

## 1. お名前.com で A レコード追加

1. お名前.com Navi にログイン
2. ドメイン → DNS 関連機能 → DNS 設定/転送設定 → `hokudaicarta.com` 選択
3. DNS レコード設定 → 追加で以下を入力:
   - ホスト名: `new`
   - TYPE: `A`
   - VALUE: Oracle インスタンスの Public IP
   - TTL: `3600` (1 時間、変更時の反映時間トレードオフ)
   - 優先度: 空欄
4. 確認画面で「DNS レコード設定用ネームサーバー変更不要」が選択されている
   ことを確認 → 設定
5. 旧 kagetra の root レコード (`hokudaicarta.com` の A) は触らない

## 2. DNS 反映待ち

- お名前.com の DNS 反映は通常 5 分〜数時間、最大 24-48h
- 確認 (ローカル PC から):

  ```bash
  dig new.hokudaicarta.com +short
  ```

  → Oracle インスタンスの Public IP が返れば反映完了
- 反映前は次の §5 certbot が HTTP-01 challenge (port 80 経由で `new.
  hokudaicarta.com` への到達性検証) で失敗するので、必ず DNS 反映後に進む

## 3. nginx インストール

- Ubuntu 22.04 (Oracle インスタンス上で実行):

  ```bash
  sudo apt update
  sudo apt install -y nginx
  ```

- 起動確認:

  ```bash
  sudo systemctl status nginx
  curl -I http://localhost
  ```

- 外部からの確認 (ローカル PC で):

  ```bash
  curl -I http://new.hokudaicarta.com
  ```

  → 200 OK で「Welcome to nginx!」default page が返れば OK
- 502 や connection refused → §4 (Security List) または iptables
  (`oracle-setup.md` §5) を再確認

## 4. nginx reverse proxy 設定 (Phase A スコープ: default page まで)

- Phase A では default page が `http://new.hokudaicarta.com` で見える
  状態まで構築
- Phase B で web (port 3000) / api (port 3001) への reverse proxy 設定を
  本格追加
- nginx default の `/etc/nginx/sites-enabled/default` はこの段階では
  触らない

## 5. certbot で Let's Encrypt SSL 取得

- certbot + nginx plugin インストール:

  ```bash
  sudo apt install -y certbot python3-certbot-nginx
  ```

- 証明書取得 (HTTP-01 challenge、port 80 経由で Let's Encrypt から検証
  ping を受ける):

  ```bash
  # メールアドレス入力 (証明書失効通知用)、利用規約同意 (Y)、
  # HTTPS リダイレクト設定で `2` (Redirect, HTTP → HTTPS 自動) を選択。
  sudo certbot --nginx -d new.hokudaicarta.com
  ```

- 自動更新 timer 確認:

  ```bash
  sudo systemctl list-timers | grep certbot
  ```

  → `certbot.timer` が active (2 回/日チェック、期限 30 日前で自動更新)

## 6. SSL 動作確認

- ローカル PC から:

  ```bash
  curl -I https://new.hokudaicarta.com
  ```

  → `HTTP/2 200` と `server: nginx/...` が返れば OK (HSTS ヘッダー
  `strict-transport-security` は certbot --nginx 標準では付与されない、
  必要なら Phase B で nginx に `add_header Strict-Transport-Security ...
  always;` を明示追加してから期待ヘッダに加える)
- ブラウザで `https://new.hokudaicarta.com` を開き、鍵マーク + 「証明書:
  Let's Encrypt」確認
- 証明書期限確認:

  ```bash
  sudo certbot certificates
  ```

## 7. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| `dig` が IP を返さない | DNS 反映待ち (最大 24-48h)、お名前.com の DNS 設定画面で A レコード追加されていることを再確認 |
| `curl http://new.hokudaicarta.com` connection refused | iptables で 80/443 が ACCEPT されていない、`sudo iptables -L INPUT --line-numbers` で INPUT 6 行目に 80/443 ACCEPT があることを確認 (`oracle-setup.md` §5) |
| `curl` is timeout | Security List で 80/443 ingress が開いていない、Oracle Cloud Console で確認 (`oracle-setup.md` §4) |
| certbot が `Connection refused` で失敗 | port 80 が外部から到達可能でない、§3 の `curl -I http://new.hokudaicarta.com` で 200 が返ることを先に確認 |
| certbot が `DNS problem: NXDOMAIN` | DNS 反映完了前に certbot 実行、§2 の `dig` で IP が返ってから再実行 |
| certbot 自動更新 timer が動かない | `sudo systemctl enable --now certbot.timer` で有効化、`sudo certbot renew --dry-run` で更新 simulation 実行 |

## 参考リンク

- [Let's Encrypt 公式](https://letsencrypt.org/)
- [certbot User Guide (nginx)](https://eff-certbot.readthedocs.io/en/latest/using.html)
- [お名前.com Navi (DNS 設定)](https://navi.onamae.com/)
