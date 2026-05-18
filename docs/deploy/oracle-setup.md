# Oracle Cloud Always Free セットアップ (Tokyo / ARM Ampere A1)

kagetra_new の本番インスタンスを Oracle Cloud Always Free (東京 region、
ARM Ampere A1 4 OCPU/24GB RAM/200GB SSD) に立てるまでの手順。Ubuntu 22.04
LTS aarch64 image を使う前提。

## 0. 前提

- Oracle Cloud Always Free tier (Tokyo region) — 永続無料、課金条件は
  Always Free 枠超過時のみ
- スペック: ARM Ampere A1 Flex 4 OCPU / 24 GB RAM / 200 GB Block Volume /
  10 TB outbound transfer/月
- OS: Ubuntu 22.04 LTS (Canonical-Ubuntu-22.04-aarch64 系 image)
- ホーム region: **Japan East (Tokyo)** — テナンシ作成時に決定、後から
  変更不可
- アカウントは Pay-as-you-go へ昇格推奨 (詳細 §2、Always Free 枠内は
  課金 0)

## 1. アカウント作成

- oracle.com/cloud/free でサインアップ
- ホーム region 選択時に必ず **Japan East (Tokyo)** を選ぶ (後変更不可、
  間違えたらテナンシ作り直し)
- クレカ認証必須 (Always Free 内は課金されないが入力必須)
- 住所は英語表記、氏名は日本語 OK
- 認証完了まで数十分〜数時間

## 2. Pay-as-you-go 昇格 (推奨)

- 理由 1: ARM A1 Tokyo は常時枯渇傾向 → 昇格すると priority queue 入りで
  Out of Capacity 回避
- 理由 2: 30 日無アクセス / CPU < 20%/7d で Always Free インスタンスが
  suspend されるが、Pay-as-you-go では idle reclaim 対象外
- Always Free 枠内の利用なら**課金は発生しない** (重要)
- 手順: Billing → Upgrade and Manage Payment → Upgrade to Pay As You Go
- 反映に 1-2 日かかる場合あり

## 3. ARM Ampere A1 インスタンス作成

- Compute → Instances → Create instance
- Shape: **VM.Standard.A1.Flex (4 OCPU / 24 GB)** に変更
- Image: Canonical Ubuntu 22.04 (Build for aarch64)
- Networking: 既存 VCN + Subnet (デフォルトでよい)
- SSH 鍵: **「Paste public keys」を選択し、ローカル `ssh-keygen -t ed25519`
  生成済の公開鍵を貼り付け** ("Generate a key pair for me" は秘密鍵 DL
  1 回限りで詰むリスクあり、避ける)
- ログインユーザー: `ubuntu` (Ubuntu image のデフォルト)
- Boot Volume: 200 GB (Always Free 上限) に拡張可
- 罠: Tokyo で "Out of host capacity" 出る場合 → §2 Pay-as-you-go 昇格
  + 別 AZ (AD-1/2/3) 順番に試行 + コンソール 30 秒毎リトライ

## 4. Security List (VCN firewall)

- Networking → Virtual Cloud Networks → 該当 VCN → Security Lists →
  Default Security List → Add Ingress Rules
- 追加するルール 1 件:
  - Source CIDR: `0.0.0.0/0`
  - IP Protocol: TCP
  - Destination Port Range: `80,443` (カンマ区切りで両ポート同時可)
  - Stateless: OFF
- SSH (22) はデフォルトで開いている (変更不要)
- **PostgreSQL 5432 は絶対に外から開けない** (Phase B で Docker 同居、
  `127.0.0.1:5432` バインド厳守)
- 罠: Security List だけ開けても次の §5 iptables を通らないと外部通信
  不可

## 5. iptables (Ubuntu image の鬼門)

- Oracle 提供の Ubuntu image は **`iptables-persistent` で INPUT チェーン
  末尾に `REJECT all` が入っている** → Security List で 80/443 開けても
  弾かれる
- 80/443 を INPUT の早い位置に挿入する必要あり
- コマンド (順序重要、`-I INPUT 6` で REJECT より前に挿入):

  ```bash
  # `-I INPUT 6` で 6 行目に挿入 (末尾の REJECT より前に来るのが肝)。
  # `-A INPUT` (append) では REJECT に先に当たって弾かれる。
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save
  ```

- 検証: `sudo iptables -L INPUT --line-numbers` で INPUT 6 行目に ACCEPT
  が挿入されていること
- ufw は使わない (iptables-persistent と競合、Oracle image にはデフォルト
  未インストール)

## 6. swap 4GB 作成

- 24GB RAM あるが PostgreSQL + Next.js + Hono + mail-worker 同居の OOM
  保険として 4GB
- 8GB 以上は swap thrashing で逆効果
- コマンド:

  ```bash
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  # 再起動後も有効化するため fstab に追記
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  # vm.swappiness=10 は DB サーバー推奨値 (default 60 だと不要 swap 多発)
  sudo sysctl vm.swappiness=10
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
  ```

- vm.swappiness=10 は DB サーバー推奨値 (default 60 だと不要 swap 多発)

## 7. system user 作成

- mail-worker.md と同じ `kagetra` user を使う (本番は web/api/mail-worker
  全て同 user で運用)
- **`-m` 付けない罠**: `/etc/skel` 由来の `.bashrc` が home に作られると
  後の `git clone /opt/kagetra` が「destination is not empty」で失敗
- コマンド:

  ```bash
  # `-m` は付けない。`/etc/skel` 由来の .bashrc が home にコピーされて
  # 後の `git clone /opt/kagetra` が失敗するため。
  sudo useradd -r -s /bin/bash -d /opt/kagetra kagetra
  sudo install -d -o kagetra -g kagetra -m 0755 /opt/kagetra
  ```

- (Phase B で `git clone https://github.com/poponta2020/kagetra_new.git /opt/kagetra`
  を実行)

## 8. Node.js / corepack / Docker インストール

- Node.js 22.13+ (mail-worker `engines.node` 要件): NodeSource apt
  repository 経由

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node --version  # v22.x 確認
  ```

- corepack 有効化 (pnpm を Node 同梱経由で解決):

  ```bash
  sudo corepack enable
  ```

- Docker (Ubuntu 22.04 ARM64 公式 apt 経由): Docker 公式手順
  https://docs.docker.com/engine/install/ubuntu/ に従う
- kagetra user を docker group に追加 (docker compose 実行用):

  ```bash
  sudo usermod -aG docker kagetra
  ```

## 9. Always Free 維持の注意点

- **30 日無アクセス**: アカウントが abandoned 判定で suspend → 月 1 回
  コンソールログインで OK
- **CPU 利用率 < 20% (7 日 95th percentile)**: idle 判定でインスタンス
  停止 (削除ではないが、再起動時 Out of Capacity リスク)
- 本番運用 (web + api + mail-worker 30min cron) では通常閾値を超える想定
  だが、心配なら軽い cron で負荷生成
- **決定打**: §2 Pay-as-you-go 昇格で両方とも対象外になる
- TOS 違反例 (kagetra は該当なし): マイニング / VPN プロキシ販売 /
  トラフィック中継

## 参考リンク

- [Oracle Cloud Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)
- [Oracle: Always Free Resources 公式 doc](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Resolving Out of Capacity (Hitrov, OCI CLI 自動リトライ)](https://hitrov.medium.com/resolving-oracle-cloud-out-of-capacity-issue-and-getting-free-vps-with-4-arm-cores-24gb-of-a3d7e6a027a8)
- [Enabling Network Traffic to Ubuntu Images in OCI (Oracle 公式ブログ — iptables 罠)](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure)
- [Docker Engine on Ubuntu (公式)](https://docs.docker.com/engine/install/ubuntu/)
