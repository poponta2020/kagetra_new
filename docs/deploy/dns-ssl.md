# DNS (AWS Lightsail DNS zone) + nginx + Let's Encrypt SSL

kagetra_new の本番ドメイン `new.hokudaicarta.com` を Oracle Cloud
インスタンスに向け、nginx + Let's Encrypt で HTTPS 化するまでの手順。
お名前.com 取得済の `hokudaicarta.com` を流用し、サブドメイン分離方式で
旧 kagetra (root) と並行稼働する。

## 0. 前提

- ドメイン: `hokudaicarta.com` (お名前.com 取得済)
- 旧 kagetra: root `hokudaicarta.com` で稼働中 → **一切触らない**
- 新システム: `new.hokudaicarta.com` でサブドメイン分離
- **DNS 解決の実態**: 旧 kagetra は **AWS Lightsail** で稼働しており、
  お名前.com 側のネームサーバー設定で `awsdns-*` (Route 53) に委任済。
  Lightsail コンソールの「**DNS ゾーン (DNS zones)**」機能で管理する形態
  になっているため、お名前.com Navi の「DNS 設定/転送設定」で
  レコード追加しても**反映されない**。
- DNS 管理: **AWS Lightsail コンソール → ネットワーキング → DNS ゾーン**
  で `new` の A レコードを追加する (Route 53 コンソールから直接でも可だが、
  既存運用が Lightsail なら Lightsail UI が正)
- 前提: Oracle インスタンス起動済 + 80/443 が外部から到達可能
  (`oracle-setup.md` §1-§5 完了)
- インスタンス Public IP: Oracle Cloud Console → Instances → 詳細画面で
  確認

## 1. Lightsail DNS ゾーンで A レコード追加

1. AWS Lightsail Console (`https://lightsail.aws.amazon.com/`) にログイン
2. 上部メニュー **ネットワーキング (Networking)** タブ
3. **DNS ゾーン (DNS zones)** リストに `hokudaicarta.com` があるはず → クリック
4. **DNS レコード** タブ → **+ レコードを追加 (Add record)** ボタン
5. 以下を入力:
   - レコードタイプ: **A レコード**
   - サブドメイン: `new` (右側に `.hokudaicarta.com` が自動表示)
   - 解決先 (Resolves to): Oracle インスタンスの Public IP (例: `140.238.51.41`)
   - TTL: `300` (5 分、セットアップ初期は短く iteration、安定後 3600 へ変更可)
6. 右側の **✓ (緑のチェック)** または「保存」をクリック
7. 一覧に `A new.hokudaicarta.com → <IP>` が追加表示されることを確認
8. 旧 kagetra の root レコード (`hokudaicarta.com` の A) は触らない

## 2. DNS 反映待ち

- Lightsail DNS の反映は通常 **数十秒〜数分**で完了 (Route 53 経由のため
  比較的速い。お名前.com Navi 直管理の typical 5 分〜24h より短い)
- 確認 (ローカル PC から):

  ```bash
  # dig がない Windows なら nslookup new.hokudaicarta.com 8.8.8.8 でも可
  dig new.hokudaicarta.com +short
  ```

  → Oracle インスタンスの Public IP が返れば反映完了
- 反映前は次の §5 certbot が HTTP-01 challenge (port 80 経由で
  `new.hokudaicarta.com` への到達性検証) で失敗するので、必ず DNS 反映後に
  進む
- 反映確認のもうひとつの方法 (権威 NS に直接問い合わせ):

  ```bash
  dig new.hokudaicarta.com @ns-643.awsdns-16.net +short
  # ns-* のドメイン名は `dig -type=NS hokudaicarta.com` で確認できる
  ```

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
  # 対話なし版 (一括):
  sudo certbot --nginx -d new.hokudaicarta.com \
    --non-interactive --agree-tos -m <あなたのメール> --redirect

  # 対話版 (個別確認したい場合):
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
| `dig` が IP を返さない | DNS 反映待ち (Lightsail DNS なら通常数分以内)、Lightsail コンソールで A レコードが保存されていることを再確認。お名前.com Navi で追加していた場合は無効 (§1 参照、Lightsail で再登録) |
| `curl http://new.hokudaicarta.com` connection refused | iptables で 80/443 が ACCEPT されていない、`sudo iptables -L INPUT --line-numbers` で INPUT の REJECT より前に 80/443 ACCEPT があることを確認 (`oracle-setup.md` §5) |
| `curl` が timeout | Security List で 80/443 ingress が開いていない、Oracle Cloud Console で確認 (`oracle-setup.md` §4) |
| certbot が `Connection refused` で失敗 | port 80 が外部から到達可能でない、§3 の `curl -I http://new.hokudaicarta.com` で 200 が返ることを先に確認 |
| certbot が `DNS problem: NXDOMAIN` | DNS 反映完了前に certbot 実行、§2 の `dig` で IP が返ってから再実行 |
| certbot 自動更新 timer が動かない | `sudo systemctl enable --now certbot.timer` で有効化、`sudo certbot renew --dry-run` で更新 simulation 実行 |

## 参考リンク

- [AWS Lightsail DNS Zones (公式 doc)](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-dns.html)
- [Let's Encrypt 公式](https://letsencrypt.org/)
- [certbot User Guide (nginx)](https://eff-certbot.readthedocs.io/en/latest/using.html)
- [お名前.com Navi (DNS 設定)](https://navi.onamae.com/) — registrar のみ、DNS 解決は Lightsail/Route 53
