# Deploy: entry-overdue-alert

会内締切超過の未申込大会を管理者個人 LINE へ毎朝通知するバッチの本番反映手順。
既存の `new.hokudaicarta.com`（Oracle Cloud 東京）稼働環境への追加で、単独で実施できる。

前提（[event-lifecycle-notify.md](./event-lifecycle-notify.md) と共通）:
- ホスト TZ は `Asia/Tokyo`（systemd `OnCalendar` がローカル時刻＝JST で評価される）。`timedatectl` で確認。
- アプリは `/opt/kagetra`、実行ユーザーは `kagetra:kagetra`、環境変数は `/opt/kagetra/.env.production`。
- **`line_channels` に `status='system'` の行があり、`notification_line_user_id` が管理者の LINE userId で埋まっている**こと（メール取込アラートで既に使っている経路。未投入なら `apps/mail-worker/scripts/seed-system-channel.ts`）。
- **`PUBLIC_BASE_URL` が `.env.production` に入っている**こと。サマリの各行に大会詳細の絶対 URL を載せるため必須で、未設定だとバッチは exit 1 で止まる（リンクなしの通知を送るより設定漏れに気づかせる方針）。既存の要綱送信（`line-broadcast-guidelines.ts`）が同じ変数を使っているので、通常は既に設定済み。

## 0. **マージ前に** scoped sudoers を本番へ再配置する（必須）

本 PR は新規 systemd unit を 2 本追加する。`infra/sudoers/kagetra-deploy` は unit 名を固定列挙しており（ワイルドカード禁止＝privilege escalation 対策）、**sudoers を本番に反映しないまま unit を含む PR をマージすると、auto-deploy が最初の `install` で sudo に蹴られて fail する**。auto-deploy は sudoers 自身を更新しないため、この手順だけは先行して手で行う。

```bash
cd /opt/kagetra
git fetch origin && git checkout origin/feature/entry-overdue-alert -- infra/sudoers/kagetra-deploy
sudo install -m 0440 -o root -g root \
  /opt/kagetra/infra/sudoers/kagetra-deploy /etc/sudoers.d/kagetra-deploy
sudo visudo -c -f /etc/sudoers.d/kagetra-deploy   # syntax check
```

（マージ後に `/opt/kagetra` を通常どおり `git pull` すれば、この一時 checkout は main の内容で上書きされる。）

## 1. コード取得 → 依存解決 → マイグレーション

**順序が重要**: migration `0043` は `git pull` するまで手元に存在しない。先に `db:migrate` を実行しても何も適用されず、その状態で新しい web を起動すると `/events` の `entry_status <> 'not_applying'` が未拡張の enum に対して実行され `invalid input value for enum` になる。

```bash
cd /opt/kagetra
git pull
corepack pnpm install --frozen-lockfile
# db:push は interactive prompt で詰むので必ず db:migrate を使う。
# 0043 は event_entry_status への ALTER TYPE ADD VALUE のみ（既存行の値は変わらない）。
DATABASE_URL=postgres://... pnpm db:migrate
```

## 2. apps/web リビルド

進行管理パネル（`/events/[id]`）に「申し込まない」ボタンが増え、`/events` 一覧が `not_applying` を除外するようになるため、web のリビルドが必要。

```bash
cd /opt/kagetra
pnpm --filter @kagetra/web build
# standalone は .next/static と public を手動コピーしないと CSS/JS が 404 になる
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/
cp -r apps/web/public apps/web/.next/standalone/apps/web/
sudo systemctl restart kagetra-web
```

アラートバッチ自体は Next ランタイムに依存しない（timer が直接 tsx で実行する）。

## 3. systemd timer の配置と有効化

日次 07:00 JST の timer を 1 本追加する（既存の 00:00 lifecycle-reminders / 04:00 broadcast-cleanup とは別ユニット。管理者の端末が深夜に鳴らないよう時刻を分けている）。

**通常は `scripts/deploy/auto-deploy.sh` がこの節を自動で行う**（`apps/*/systemd/kagetra-*.{service,timer}` の変更を検出して install → `daemon-reload` → timer は `enable --now` + `restart` + `is-active`）。§0 の sudoers 反映が済んでいればそのまま通る。手で行う場合は以下。

```bash
sudo install -m 644 -o root -g root \
  /opt/kagetra/apps/web/systemd/kagetra-entry-overdue-alert.service /etc/systemd/system/kagetra-entry-overdue-alert.service
sudo install -m 644 -o root -g root \
  /opt/kagetra/apps/web/systemd/kagetra-entry-overdue-alert.timer   /etc/systemd/system/kagetra-entry-overdue-alert.timer
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-entry-overdue-alert.timer

# 次回発火予定を確認
systemctl list-timers kagetra-entry-overdue-alert.timer
```

`enable --now` はタイマーを起動するだけで、サービスは 07:00 まで実行されない（`.timer` に `Requires=` を置いていないため。既存 lifecycle-reminders との差異はユニット内のコメント参照）。

## 4. 動作確認

### 4-a. 候補のドライ確認（送信しない）

`--dry-run` は対象の大会と実際に送る文面を表示するだけで push しない。このアラートは once-ever ログを持たないため、本番データに対して何度実行しても安全（消費するスロットが無い）。

```bash
cd /opt/kagetra
sudo -u kagetra DATABASE_URL=postgres://... PUBLIC_BASE_URL=https://new.hokudaicarta.com \
  pnpm --filter @kagetra/web exec tsx scripts/send-entry-overdue-alert.ts --dry-run
```

対象 0 件なら `0 candidate(s)` だけが出る（本番運用でも 0 件の日は送信しない）。

### 4-b. 送信パスの確認（実 LINE を叩かない）

```bash
sudo -u kagetra DATABASE_URL=postgres://... PUBLIC_BASE_URL=https://new.hokudaicarta.com \
  LINE_NOTIFY_DRY_RUN=1 \
  pnpm --filter @kagetra/web exec tsx scripts/send-entry-overdue-alert.ts
# → "N candidate(s), push sent" を確認。実 LINE には届かない。
```

`skipped: no-channel` / `skipped: no-user-id` が出た場合は system_notify チャネルの設定漏れ（バッチは正常終了する仕様）。前提の節に戻って `line_channels` を確認する。

### 4-c. 本番送信の確認

```bash
sudo systemctl start kagetra-entry-overdue-alert.service
sudo journalctl -u kagetra-entry-overdue-alert.service -n 50 --no-pager
```

管理者の LINE にサマリが 1 通届き、各行のリンクから該当の大会詳細が開ければ完了（要件 AC-21）。

## 5. 運用メモ

- **毎日鳴る。** このアラートは意図的に冪等性を持たない（`event_lifecycle_notifications` を使わない）。会内締切を過ぎて未申込のままなら、申込済にするか「申し込まない」にするまで毎朝届く。手動 `systemctl start` すればその場でもう 1 通届く。
- **止め方は 2 つ。** 主催者へ申し込んだら進行管理から「申込済にする」、申込者がいなくて見送るなら「申し込まない」。後者は `/events` 一覧からも消えるため、戻したいときは大会詳細の URL を直接開いて「未申込に戻す」。
- **送信失敗はリトライしない**（429 の再送を除く）。翌朝また対象になるため。失敗は journal に残る。
