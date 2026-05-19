# PostgreSQL 日次バックアップ (Cloudflare R2)

kagetra_new 本番 DB の日次 pg_dump を Cloudflare R2 へ GFS rotation で
転送する手順。systemd timer (`kagetra-backup.timer`) から `scripts/deploy/backup.sh`
が毎日 03:00 JST に起動し、失敗時は LINE で管理者に通知する。Phase A
(インフラ) と Phase B (apps/web/api + postgres + nginx) のセットアップ完了が
前提。

## 0. 前提

- Phase A (`docs/deploy/oracle-setup.md` / `docs/deploy/dns-ssl.md`) と
  Phase B (`docs/deploy/postgres.md` / `docs/deploy/web.md` /
  `docs/deploy/api.md`) のセットアップ完了
- Ubuntu 22.04 LTS aarch64、systemd v249+ (`OnCalendar=*-*-* 03:00:00 Asia/Tokyo`
  の inline TZ 指定は v249+ 必須)
- Cloudflare アカウント + R2 有効化済 (10GB 無料枠で十分、§7 の保持目安参照)
- `/opt/kagetra` に repo clone + `pnpm install --frozen-lockfile` 済
  (`apps/mail-worker/node_modules/.bin/tsx` が executable として配置されること)
- mail-worker の `line_channels` テーブルに `status='system'` 行が seed 済
  (`apps/mail-worker/scripts/seed-system-channel.ts`、`docs/deploy/mail-worker.md` §2)

## 1. Cloudflare R2 セットアップ

### 1.1 bucket 作成

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. 左サイドバー「R2」を開く (初回は有効化ウィザードを通過、課金登録は不要で
   10GB 無料枠が即時利用可能)
3. 「Create bucket」→ bucket 名 `kagetra-backup` を入力
4. Location は「Automatic」のまま (R2 は region 概念がほぼ無視できる)
5. 「Create bucket」で確定

### 1.2 API Token 発行

1. R2 ページの右上「Manage R2 API Tokens」を開く
2. 「Create API Token」をクリック
3. Token 設定:
   - **Token name**: `kagetra-backup` (任意)
   - **Permissions**: **Object Read & Write** を選択 (Admin Read & Write は
     最小権限ではないので避ける)
   - **Specify bucket(s)**: 「Apply to specific buckets only」を選び
     `kagetra-backup` のみを指定
   - **TTL**: 「forever」(無期限) — 期限切れによる本番停止を避ける
4. 「Create API Token」で発行
5. 表示される **Access Key ID** と **Secret Access Key** を即時控える
   (再表示不可、紛失したら token を作り直し)

### 1.3 Account ID 確認

R2 dashboard 右側に表示される **Account ID** を控える (`R2_ACCOUNT_ID` に
入る値)。

### 1.4 endpoint URL の形式

backup.sh が `RCLONE_CONFIG_R2_ENDPOINT` として組み立てる URL:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

env には `R2_ACCOUNT_ID` のみを記録し、endpoint URL は backup.sh が組み立てる。

> **note**: Object Read & Write の token は ListBuckets 不可。backup.sh は
> `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` を export して HeadBucket 呼び出しを
> skip するため、追加権限は不要。Admin 系の token を発行する必要は無い。

## 2. rclone install

Ubuntu 22.04 標準 apt の rclone は古く (v1.53)、R2 周りの挙動が安定しない。
公式 install スクリプトで v1.66+ を入れる。

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version  # v1.66 以上であることを確認
```

apt 経由 (`sudo apt install rclone`) は非推奨。

## 3. local backup ディレクトリ作成

```bash
sudo install -d -o kagetra -g kagetra -m 0700 /var/backups/kagetra
sudo install -d -o kagetra -g kagetra -m 0700 /var/backups/kagetra/daily
sudo install -d -o kagetra -g kagetra -m 0700 /var/backups/kagetra/weekly
sudo install -d -o kagetra -g kagetra -m 0700 /var/backups/kagetra/monthly
```

mode 0700 で kagetra user 以外から読めないようにする (dump にはパスワード hash
等が含まれ得るため、他 user の閲覧を遮断する)。

## 4. .env.production への R2 行追加

`/opt/kagetra/.env.production` (mode 0600, owner kagetra) の末尾に R2
セクションを追加 (`.env.production.example` の Phase C 部分をテンプレに):

```env
# === Cloudflare R2 Backup (Phase C) ===
R2_ACCOUNT_ID=<§1.3 で控えた Account ID>
R2_ACCESS_KEY_ID=<§1.2 で控えた Access Key ID>
R2_SECRET_ACCESS_KEY=<§1.2 で控えた Secret Access Key>
R2_BUCKET=kagetra-backup
```

Phase B で既に設定済の mode 0600 / owner kagetra を維持する (新規行を追加
しても perm は変えない)。

```bash
ls -l /opt/kagetra/.env.production
# -rw------- 1 kagetra kagetra ... .env.production であることを確認
```

## 5. systemd unit 配置 + 有効化

```bash
sudo cp /opt/kagetra/apps/mail-worker/systemd/kagetra-backup.service /etc/systemd/system/
sudo cp /opt/kagetra/apps/mail-worker/systemd/kagetra-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-backup.timer
```

設置後の verify (PR では systemd-analyze を踏めていないので運用者側で必ず実施):

```bash
sudo systemd-analyze verify /etc/systemd/system/kagetra-backup.service
sudo systemd-analyze verify /etc/systemd/system/kagetra-backup.timer
systemctl list-timers --all | grep kagetra-backup
systemd-analyze calendar "*-*-* 03:00:00 Asia/Tokyo"
# → 次回発火時刻が "Next elapse: ... JST" で JST 表示されること
```

`Active: active (waiting)` で `Trigger: ... JST` が翌日 03:00 を指せば正常。

## 6. 動作確認

### 6.1 手動実行

timer 発火を待たず、即時手動 trigger できる:

```bash
sudo systemctl start kagetra-backup.service
sudo journalctl -u kagetra-backup.service -e --no-pager
```

### 6.2 期待されるログ抜粋

```text
[backup] stage=pre_check: ensure local dirs and verify postgres reachable
[backup] postgres ready
[backup] stage=pg_dump: dumping to /var/backups/kagetra/daily/kagetra-...dump
[backup] pg_dump complete: /var/backups/kagetra/daily/kagetra-...dump (NNN bytes)
[backup] stage=r2_upload_daily: uploading to R2:kagetra-backup/daily/kagetra-...dump
[backup] r2 upload (daily) complete
[backup] stage=weekly_promote: DOW=... (...)
[backup] stage=monthly_promote: DOM=... (...)
[backup] stage=rotation_local: pruning local tiers (daily=7d, weekly=56d, monthly=365d)
[backup] local rotation complete
[backup] stage=rotation_r2: pruning R2 tiers (daily=7d, weekly=8w=56d, monthly=12M=365d)
[backup] r2 rotation complete
[backup] all stages completed successfully (ts=..., dow=..., dom=...)
```

`all stages completed successfully` が出ていれば成功。

### 6.3 R2 dashboard で確認

Cloudflare Dashboard → R2 → `kagetra-backup` → `daily/` を開き、
`kagetra-<TODAY_JST>.dump` が当日付で存在することを確認する。CLI 側からも:

```bash
sudo -u kagetra bash -c '
  source /opt/kagetra/.env.production
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_REGION=auto
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
  rclone lsf R2:kagetra-backup/daily/ --format pt
'
```

### 6.4 失敗通知テスト

意図的に失敗させて LINE 通知が届くか確認する (`.env.production` で
R2_BUCKET を一時的に不正値に差し替える):

```bash
# 1. backup を失敗させるため、R2_BUCKET を存在しない値に書き換える
sudo -u kagetra sed -i 's/^R2_BUCKET=.*/R2_BUCKET=nonexistent-bucket-test/' /opt/kagetra/.env.production

# 2. 手動 trigger (rclone 段階で 404 or 403 になる想定)
sudo systemctl start kagetra-backup.service
sudo journalctl -u kagetra-backup.service -e --no-pager

# 3. ログに以下のような行が出て、seed 済 admin の LINE に通知が届くことを確認:
#    [backup] ERROR: kagetra backup failed: stage=..., exit=..., host=..., ts=... JST
#    [notify-system] pushed

# 4. テスト完了後、R2_BUCKET を必ず元に戻す
sudo -u kagetra sed -i 's/^R2_BUCKET=.*/R2_BUCKET=kagetra-backup/' /opt/kagetra/.env.production
sudo systemctl start kagetra-backup.service  # 正常系に戻ったことを確認
```

通知が届かない場合は `apps/mail-worker/scripts/seed-system-channel.ts` の
実行漏れか token 失効を疑う (§10 トラブルシュート参照)。

### 6.5 dry-run モードでの試運転

本番稼働を始める前に、通知だけ抑止して backup フローを流す期間を取りたい
場合は `LINE_NOTIFY_DRY_RUN=1` を env に一時追加する:

```env
# /opt/kagetra/.env.production
LINE_NOTIFY_DRY_RUN=1
```

この状態で失敗させても LINE には飛ばず、journal に
`[notify-system] skipped: dry-run` 相当のログだけ出る。dry-run 期間が
終わったら **必ず行ごと削除** する (`=0` でも明示しておけば事故防止になるが、
削除が一番安全)。本番では絶対に `=1` のままにしない。

## 7. GFS rotation 概念図

```text
                          rclone copyto                     find -mtime / rclone delete
                  +--------------------------+
pg_dump -> daily/ |  -> R2:kagetra-backup/   |--> 7日より古いものを削除 (8 ファイル残る)
                  +--------------------------+
                                |
                                v (cp、日曜のみ)
                         weekly/  -->  R2/weekly/   --> 8週(56日)より古いものを削除
                                |
                                v (cp、1日のみ)
                         monthly/ -->  R2/monthly/  --> 12ヶ月(365日)より古いものを削除
```

保持目安 (DB 1GB 想定、本番想定値):

| 層 | 取得タイミング | 保持期間 (local + R2) | 平均サイズ目安 (1GB 想定) |
|---|---|---|---|
| daily | 毎日 03:00 JST | 7日 (8 ファイル残存) | 1GB × 8 = 8GB |
| weekly | 日曜 03:00 JST | 8週 (9 ファイル残存) | 1GB × 9 = 9GB |
| monthly | 1日 03:00 JST | 12ヶ月 (13 ファイル残存) | 1GB × 13 = 13GB |

R2 free tier は 10GB なので、上記想定値 (合計 30GB) は free tier を超える。
実 DB が小さい (会員 100 名超 + 試合履歴で数十〜数百 MB 程度を想定) ことを
前提に運用する。`docs/deploy/README.md` の構成表「バックアップ」行 (10GB 無料
tier, GFS rotation) と整合確認しつつ、月次 dump サイズが想定を超えた場合は
保持期間を短縮するか月次層のみ別 storage への退避を検討する。

## 8. 復元手順

```bash
# 1. R2 から該当 dump を取得 (rclone は §6.3 と同様に env で remote 設定)
sudo -u kagetra bash -c '
  source /opt/kagetra/.env.production
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_REGION=auto
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
  rclone copyto R2:kagetra-backup/daily/kagetra-2026-05-19.dump /tmp/restore.dump
'

# 2. (任意) 別 DB / 別 host に restore して差分確認するのが望ましい。
#    どうしても本番 DB に直接戻す場合は web/api/mail-worker を停止:
cd /opt/kagetra
sudo systemctl stop kagetra-web.service kagetra-api.service
sudo systemctl stop kagetra-mail-worker.timer kagetra-mail-worker.service

# 3. 既存 DB に restore (--clean --if-exists で同名 object を drop して上書き)
sudo -u kagetra bash -c '
  source /opt/kagetra/.env.production
  cd /opt/kagetra
  docker compose -f docker/docker-compose.prod.yml exec -T postgres \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < /tmp/restore.dump
'

# 4. 停止していた service を再開
sudo systemctl start kagetra-api.service kagetra-web.service
sudo systemctl start kagetra-mail-worker.timer

# 5. smoke 動作確認 (ログイン、イベント一覧、admin 画面)
curl -I https://new.hokudaicarta.com
curl -I https://new.hokudaicarta.com/hono-api/health
```

> **note**: `--clean --if-exists` は既存 table を drop してから restore する
> ため、本番 DB に対して実行すると現在のデータは失われる。原則として
> 別 DB / 別 host に展開してから差分確認する運用を推奨。やむを得ず本番 DB へ
> 直接戻す場合は、直前に `pg_dump` で現状を退避してから実施する。

## 9. 家 PC 副コピー (月次手動)

Oracle Cloud アカウントが何らかの理由で停止された場合のリスク軽減のため、
月 1 回程度、家 PC (Windows / Mac / Linux いずれでも可) に monthly tier の
副コピーを保存する。

```bash
# 家 PC 側にも rclone install + R2 token (Object Read Only 推奨で別発行) を
# 設定済の前提。家 PC 用 token は backup 用と分離し、Read 専用に絞る。
rclone copy r2:kagetra-backup/monthly/ ~/backup/kagetra/monthly/
sha256sum ~/backup/kagetra/monthly/*.dump  # 直近 dump の hash を控える
```

- 頻度: 月 1 回 (毎月 1 日の monthly tier 生成後、数日以内)
- 目的: Oracle Cloud アカウント停止 + R2 アカウント停止が同時に来た際の
  最終バックアップ
- Phase C 範囲ではこの運用は手動。自動化 (定期 cron 等) は将来別 PR

## 10. トラブルシュート

| 症状 | 原因と対応 |
|---|---|
| journal に `system channel not seeded` | `apps/mail-worker/scripts/seed-system-channel.ts` 未実行。`docs/deploy/mail-worker.md` §2 の seed 手順を実施 |
| `LINE pushMessage failed (HTTP 401)` | Channel Access Token 失効。LINE Developers Console で再発行 → `seed-system-channel.ts` を新 token で再実行 (UPDATE される) |
| `rclone: 403 Forbidden` | R2 token の Permission が `Object Read Only` になっている。`Object Read & Write` で発行し直して `.env.production` を更新 |
| `rclone: bucket not found` | `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` が export されていない。`scripts/deploy/backup.sh` 内で export しているはずなので、env 直書きで `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=false` 等にオーバーライドされていないか確認 |
| `pg_dump: server version mismatch` | host の `pg_dump` が container 内 PostgreSQL とバージョン不整合。`backup.sh` は `docker compose exec -T postgres pg_dump` 経由で呼ぶので本症状は出ないはず。出るなら backup.sh が想定外の path / version で実行されている疑い、`which pg_dump` で host 側 binary が紛れていないか確認 |
| timer が発火しない | `systemctl list-timers --all \| grep kagetra-backup` で next firing を確認。`Persistent=true` のため reboot 後の catchup は自動だが、`systemctl status kagetra-backup.timer` で `Active: active (waiting)` か確認。`Active: inactive (dead)` なら `sudo systemctl enable --now kagetra-backup.timer` で再 enable |
| local `/var/backups/kagetra` の容量増加 | `find -mtime` rotation の動作確認 (`ls -lh /var/backups/kagetra/daily/` で 8 ファイル以下か)、`du -sh /var/backups/kagetra/` で disk usage 確認。期待より多い場合は backup.sh の stage=rotation_local ログを `journalctl` で追う |
| dry-run のまま稼働している | `.env.production` から `LINE_NOTIFY_DRY_RUN` 行を削除、または `=0` に変更して `sudo systemctl daemon-reload` (env 変更は次回 service 起動から反映)。本番では絶対に `=1` のままにしない |

## 11. 関連 file

- `scripts/deploy/backup.sh` — backup スクリプト本体 (pg_dump + R2 upload + GFS rotation)
- `apps/mail-worker/scripts/notify-system.ts` — 失敗時 LINE 通知 CLI (ERR trap から呼ばれる)
- `apps/mail-worker/src/notify/line.ts` — `pushSystemNotification` 実装 (SDK ラッパー)
- `apps/mail-worker/systemd/kagetra-backup.service` — systemd service unit
- `apps/mail-worker/systemd/kagetra-backup.timer` — systemd timer unit (03:00 JST)
- `.env.production.example` — env テンプレート (R2 セクション含む)
- `apps/mail-worker/scripts/seed-system-channel.ts` — system_channel seed (前提、`docs/deploy/mail-worker.md` §2 参照)
