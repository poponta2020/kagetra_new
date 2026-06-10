# mail-worker デプロイ手順 (Lightsail / systemd)

Phase P3-A メール大会取り込みの本番運用手順。`apps/mail-worker` を AWS
Lightsail 上に systemd timer で 30 分ごとに動かすまでの一通り。

## 0. 前提

- AWS Lightsail 1 GB RAM / 40 GB SSD 以上 (IMAP fetch + Claude API + DB
  write が同時に走るので 512 MB は不可)
- Ubuntu 22.04 LTS (systemd 249+ — `OnUnitActiveSec` / `Persistent=true`
  が安定して動くバージョン)
- Node.js 22.13+ (`apps/mail-worker/package.json` の `engines.node` 要件。
  corepack 経由で pnpm @ 9.x を解決)
- PostgreSQL 16 (Lightsail Managed DB or self-hosted Docker、TLS 必須)
- 専用 system user `kagetra` (sudo 不要、`/opt/kagetra` が home)。
  `useradd -m` は使わない (`/etc/skel` 由来の `.bashrc` 等が home に
  作られると後段の `git clone /opt/kagetra` が「destination is not empty」で
  失敗するため)
- ドメイン + Let's Encrypt 証明書 (web 側別途、mail-worker 自体は HTTP
  受け口を持たないので不要)

## 1. 初回デプロイ

1. system user 作成:

   ```bash
   # `-m` は付けない (review r2 blocker)。`-m` が付くと /etc/skel から
   # .bashrc / .profile が home にコピーされて後の `git clone` が失敗する。
   sudo useradd -r -s /bin/bash -d /opt/kagetra kagetra
   sudo install -d -o kagetra -g kagetra -m 0755 /opt/kagetra
   ```

2. リポジトリ clone:

   ```bash
   # 上記 `install -d` で空の /opt/kagetra を用意済みなので
   # `git clone ... /opt/kagetra` は成功する (空ディレクトリへの clone は許容)。
   sudo -u kagetra git clone https://github.com/poponta2020/kagetra_new.git /opt/kagetra
   ```

3. corepack + pnpm install (kagetra user で):

   ```bash
   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack enable && corepack pnpm install'
   ```

4. mail-worker を build:

   ```bash
   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker build'
   ```

5. `.env.production` 配置 (owner `kagetra`, mode 0600):

   ```bash
   sudo -u kagetra install -m 0600 /dev/null /opt/kagetra/.env.production
   sudo -u kagetra editor /opt/kagetra/.env.production
   ```

   中身の例 (値はダミー、実値に置換):

   ```env
   DATABASE_URL=postgres://kagetra:CHANGEME@db.example.com:5432/kagetra?sslmode=require
   # IMAP は YAHOO_IMAP_* 名で読む (apps/mail-worker/src/config.ts)。
   # HOST / PORT は省略時 imap.mail.yahoo.co.jp:993 が既定。
   YAHOO_IMAP_HOST=imap.mail.yahoo.co.jp
   YAHOO_IMAP_PORT=993
   YAHOO_IMAP_USER=kagetra-import@yahoo.co.jp
   YAHOO_IMAP_APP_PASSWORD=CHANGEME
   ANTHROPIC_API_KEY=sk-ant-CHANGEME
   # LINE は seed-system-channel.ts で DB に投入するため env 不要
   # MAIL_WORKER_LOG_LEVEL=info  # debug | info | warn | error
   ```

6. migration apply (PR1 〜 PR5 のスキーマを反映):

   ```bash
   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/shared db:migrate'
   ```

7. scoped sudoers 配置 (auto-deploy が systemd unit を更新できるようにする):

   ```bash
   sudo install -m 0440 -o root -g root \
     /opt/kagetra/infra/sudoers/kagetra-deploy /etc/sudoers.d/kagetra-deploy
   sudo visudo -c -f /etc/sudoers.d/kagetra-deploy   # syntax check
   ```

   この sudoers は repo `infra/sudoers/kagetra-deploy` で版管理されている。
   ファイルを更新したら本番側もこの手順で再配置する (auto-deploy では更新
   しない — 失敗時のロールバックが難しいため)。

   **新規 systemd unit を追加する場合**: 必ず同 PR で `infra/sudoers/kagetra-deploy`
   にも対応エントリ (`install ...` / `systemctl restart ...` / `is-active ...`) を
   追記する。sudoers は **固定 unit 名のみ** 列挙し、`kagetra-*` のワイルドカードは
   使わない (kagetra アカウントから任意 unit を root 実行できる privilege escalation
   を防ぐため)。sudoers 更新後の本番反映 (再 install) を忘れると、auto-deploy が
   新 unit の `install` で sudo に蹴られて fail するので即座に気付ける。

8. systemd unit 配置 + 有効化:

   ```bash
   # IMAP fetch 用 (30 分間隔)。mail-inbox-mailer 以降は --mode=fetch-only で AI を呼ばない。
   sudo install -m 644 -o root -g root \
     /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker.service /etc/systemd/system/kagetra-mail-worker.service
   sudo install -m 644 -o root -g root \
     /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker.timer /etc/systemd/system/kagetra-mail-worker.timer

   # mail-inbox-mailer (タスク6): AI 抽出専用 (30 秒間隔、--mode=extract-only)。
   # 「会で流す（AI 抽出）」ボタンから生成される manual_extract ジョブを処理する。
   sudo install -m 644 -o root -g root \
     /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker-extract.service /etc/systemd/system/kagetra-mail-worker-extract.service
   sudo install -m 644 -o root -g root \
     /opt/kagetra/apps/mail-worker/systemd/kagetra-mail-worker-extract.timer /etc/systemd/system/kagetra-mail-worker-extract.timer

   sudo systemctl daemon-reload
   sudo systemctl enable --now kagetra-mail-worker.timer
   sudo systemctl enable --now kagetra-mail-worker-extract.timer
   ```

   **2回目以降のデプロイ**: 上記 sudoers が配置済みなら
   `scripts/deploy/auto-deploy.sh` が `apps/*/systemd/kagetra-*.{service,timer}`
   の差分を検知して自動で `install` + `daemon-reload` + (timer なら `enable
   --now` + `restart`) を実行する。手動オペは初回 / sudoers 自体の更新時のみ。

## 2. LINE Bot 初期登録

1. [LINE Developers Console](https://developers.line.biz/console/) で
   新規 provider + Messaging API channel を作成
2. Channel ID, Channel Secret, Channel Access Token (long-lived) を控える
3. Bot 基本設定:
   - Webhook URL: 不要 (PR5 では push のみ)
   - Auto-reply / Greeting: お好みで OFF
   - 「グループ・複数人トークへの参加を許可する」: 将来の P3-B (LINE
     グループ転送) 用に **ON** にしておく
4. 管理者 (= 通知受信者) が Bot を友だち追加
5. Bot に何か発言してもらう → LINE Official Account Manager の管理画面で
   `userId` (`U` で始まる 33 桁) を取得 (もしくは Webhook 一時受信で取得)
6. seed-system-channel script を実行:

   ```bash
   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
     --channel-id=2007xxxx \
     --channel-secret=CHANGEME \
     --access-token=CHANGEME \
     --bot-id=@xxxx \
     --notification-line-user-id=Uxxxxxxxx'
   ```

   2 回目以降の実行は UPDATE になる (idempotent)。token rotation 時は
   §5 を参照。

## 3. 動作確認

- timer status:

  ```bash
  systemctl list-timers | grep kagetra
  ```

- 直近実行ログ:

  ```bash
  journalctl -u kagetra-mail-worker.service -n 50 --no-pager
  ```

- Web UI 確認: `/admin/mail-inbox` で「最近の取り込み履歴」セクションに
  run が表示される
- 手動 trigger: 同画面の「メール取り込み」ボタン → toast 表示 → 30 分
  以内に履歴に反映 (timer 発火タイミング次第)
- 即時実行したい場合:

  ```bash
  sudo systemctl start kagetra-mail-worker.service
  ```

## 4. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| `LineSystemChannelNotConfiguredError` ログ | `seed-system-channel.ts` 未実行。§2 の手順 1〜6 を実施 |
| 「pushSystemNotification skipped: no-user-id」 | seed 時に `--notification-line-user-id` 未指定。同じ script を `--notification-line-user-id=U...` 付きで再実行 (UPDATE される) |
| LINE 401 / 403 ログ | Channel Access Token expire。LINE Developers Console で再発行 → §5 |
| IMAP 認証失敗が連続 | Yahoo!Mail のアプリパスワード期限切れ。再発行 → `.env.production` の `YAHOO_IMAP_APP_PASSWORD` 更新 → `sudo systemctl restart kagetra-mail-worker.service` (timer 自体は restart 不要) |
| `tournament_drafts` が増えない | `journalctl -u kagetra-mail-worker.service` で `evaluator: classified=0` を確認。pre-filter rule (venue allow-list / sender) の意図確認 |
| timer は走るが実行されない | `systemctl status kagetra-mail-worker.service` で exit code 確認、`journalctl -u kagetra-mail-worker.service` で詳細 |
| 連続失敗で LINE 通知が止まらない | `mail_worker_runs.summary` JSON 内の `notified_imap_alert` / `notified_ai_alert` フラグを確認 (`SELECT id, summary->>'notified_imap_alert' FROM mail_worker_runs ORDER BY id DESC LIMIT 5;`)。復旧後の成功 run でフラグが付かなくなることでアラートはリセットされる |

## 5. アクセストークン rotation

1. [LINE Developers Console](https://developers.line.biz/console/) で
   「Issue token (long-lived)」 → 新トークン発行
2. `seed-system-channel.ts` を新トークンで再実行 (`status='system'` 行が
   UPDATE される):

   ```bash
   sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
     --channel-id=2007xxxx \
     --channel-secret=CHANGEME \
     --access-token=NEW_TOKEN \
     --bot-id=@xxxx \
     --notification-line-user-id=Uxxxxxxxx'
   ```

3. 旧トークンを LINE Developers Console で revoke
4. 動作確認: 任意の手動 trigger を打って通知が届くか確認

   ```bash
   sudo systemctl start kagetra-mail-worker.service
   journalctl -u kagetra-mail-worker.service -n 30 --no-pager
   ```

## 6. 監視 (任意 / 将来)

- v1: `journalctl -u kagetra-mail-worker.service` を sshd 越しに目視監視
- 将来: `mail_worker_runs` の `status != 'success'` 件数を Lightsail
  Alarms で監視
- 将来: LINE で「3 回連続失敗」アラートが届くので、それを primary signal
  にする (= 監視ツールを増やさない方針)
