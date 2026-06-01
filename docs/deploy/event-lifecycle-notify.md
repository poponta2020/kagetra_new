# Deploy: event-lifecycle-notify

大会ライフサイクル通知（申込/支払い完了 + 締切/現地払いリマインド）の本番反映手順。
既存の `new.hokudaicarta.com`（Oracle Cloud 東京）稼働環境への追加で、Phase 4 cutover とは独立に実施できる。

前提（既存 event-line-broadcast デプロイと共通、詳細は [event-line-broadcast.md](./event-line-broadcast.md)）:
- ホスト TZ は `Asia/Tokyo`（systemd `OnCalendar` がローカル時刻＝JST で評価される）。`timedatectl` で確認。
- アプリは `/opt/kagetra`、実行ユーザーは `kagetra:kagetra`、環境変数は `/opt/kagetra/.env.production`。
- LINE チャネル（access token）は DB の `line_channels` に投入済み。

## 1. マイグレーション

新規 enum 5 種・`events` への 5 カラム追加・`event_lifecycle_notifications` テーブルを追加する（migration `0017_closed_colleen_wing`）。

```bash
cd /opt/kagetra
# 既存データありで UNIQUE 等を足すため、interactive prompt を要求する db:push ではなく
# journal ベースの db:migrate を使う（非 interactive）。
DATABASE_URL=postgres://... pnpm db:migrate
```

既存 `events` 行は default（`entry_status='not_applied'` / `payment_status='unpaid'` / `payment_type=NULL`）が入り、通知は紐付け済み大会のみ対象なので既存データへの副作用はない。

## 2. apps/web リビルド

```bash
cd /opt/kagetra
git pull
pnpm install --frozen-lockfile
pnpm --filter @kagetra/web build
# standalone は .next/static と public を手動コピーしないと CSS/JS が 404 になる
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/
cp -r apps/web/public apps/web/.next/standalone/apps/web/
sudo systemctl restart kagetra-web
```

進行管理セクション（`/events/[id]`）は admin に申込/支払トグル、会員に参照バッジを出す。リマインドバッチは Next ランタイムには依存しない（後述の timer が直接 tsx で実行）。

## 3. systemd timer の配置と有効化

日次 00:00 JST のリマインド timer を 1 本追加する（既存 04:00 cleanup timer とは別ユニット）。

```bash
sudo cp apps/web/systemd/kagetra-lifecycle-reminders.service /etc/systemd/system/
sudo cp apps/web/systemd/kagetra-lifecycle-reminders.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-lifecycle-reminders.timer

# 次回発火予定を確認
systemctl list-timers kagetra-lifecycle-reminders.timer
```

`.service` は `EnvironmentFile=/opt/kagetra/.env.production` から `DATABASE_URL` を読む。リマインドは text のみなので `PUBLIC_BASE_URL` は不要。`LINE_NOTIFY_DRY_RUN` は本番では未設定にする。

## 4. 動作確認

### 4-a. 候補のドライ確認（送信せず・slot も消費しない）

`--dry-run` は条件に一致する大会と文面を表示するだけで、once-ever ログの claim も push も行わない。本番データに対して安全。

```bash
cd /opt/kagetra
sudo -u kagetra DATABASE_URL=postgres://... \
  pnpm --filter @kagetra/web exec tsx scripts/send-lifecycle-reminders.ts --dry-run
```

### 4-b. 送信パスの確認（テスト大会で）

実 LINE を叩かずに送信パス（claim → push skip → status 記録）を通すには、**捨て大会**に対して `LINE_NOTIFY_DRY_RUN=1` で 1 回実行する。once-ever ログを消費するので、本番運用したい大会では行わないこと。

```bash
sudo -u kagetra DATABASE_URL=postgres://... LINE_NOTIFY_DRY_RUN=1 \
  pnpm --filter @kagetra/web exec tsx scripts/send-lifecycle-reminders.ts
# → "sent N, skipped M, failed 0" を確認。実 LINE には届かない。
```

### 4-c. timer の手動発火（本番送信）

実際に紐付け済みグループへ届くことを確認したい場合は、対象日に該当する大会を用意した上で:

```bash
sudo systemctl start kagetra-lifecycle-reminders.service
journalctl -u kagetra-lifecycle-reminders.service --since "5 min ago"
```

## ロールバック

- timer を止める: `sudo systemctl disable --now kagetra-lifecycle-reminders.timer`
- 完了通知（server action）は events のカラム追加に依存するだけなので、UI を戻したい場合は前リビジョンを再デプロイ。スキーマ（追加カラム/テーブル）は後方互換なので DROP は不要。
