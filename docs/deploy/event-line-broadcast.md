# event-line-broadcast 本番デプロイ手順

承認済み大会案内メールを LINE グループに自動配信する機能 (Issue #54) を、
既存の `kagetra` プロダクション環境 (Oracle Cloud Always Free + Lightsail
ハイブリッド構成) に展開する手順書。

## 0. 前提

- `apps/mail-worker` が既に稼働中 (`docs/deploy/mail-worker.md` 完了済み)
- `apps/web` が `new.hokudaicarta.com` で稼働中、Nginx → Node が疎通
- PostgreSQL 16、`DATABASE_URL` 設定済み
- 専用 system user `kagetra` (home: `/opt/kagetra`)
- ホスト timezone は `Asia/Tokyo` (broadcast cleanup timer は OnCalendar
  ベースで host 時刻を読むため、ここを変えるとリリース判定が UTC ベースに
  ずれる)

### 環境変数 (`.env.production`)

`apps/web` の broadcast パイプラインに以下を **必ず** 追加する。1 つでも
欠けると添付付きメールの自動配信が `event_broadcast_messages.status=
'failed'` に倒れるので、本番反映前に確認すること。

| 変数 | 値 | 役割 |
|---|---|---|
| `DATABASE_URL` | `postgres://kagetra:...@127.0.0.1:5432/kagetra` | 既存 (mail-worker と共用) |
| `PUBLIC_BASE_URL` | `https://new.hokudaicarta.com` | LINE から fetch できる HTTPS origin。`/api/line-broadcast/attachments/[token]` と `/api/line-broadcast/images/[token]` URL の生成に使う。**必須**: 未設定 / `http://` 始まりだと添付付き配信は起動時に例外で失敗する (`apps/web/src/lib/line-broadcast.ts` の `resolveBaseUrl()`)。本文のみメールは PUBLIC_BASE_URL なしでも配信成功するが、本番ではほぼ常に添付付きなので必須扱い |
| `LINE_NOTIFY_DRY_RUN` | (未設定) | `=1` を設定すると LINE API 呼び出しを skip。本番では空のまま |

`/opt/kagetra/.env.production` への追記例:

```
DATABASE_URL=postgres://kagetra:...@127.0.0.1:5432/kagetra
PUBLIC_BASE_URL=https://new.hokudaicarta.com
```

追記後は `sudo systemctl restart kagetra-web.service` で反映する。

## 1. OS パッケージのインストール (poppler-utils + libreoffice)

PDF 画像化 (pdftoppm) と Word→PDF 変換 (libreoffice) で外部プロセスを
呼ぶため、本番ホストに以下を入れる:

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils libreoffice-core libreoffice-writer libreoffice-calc

# 動作確認:
pdftoppm -v   # poppler-utils X.Y.Z
libreoffice --version
```

ディスク使用量目安: libreoffice + ja 言語パック合計で +約 350 MB。
Always Free の 200 GB ディスクには十分収まる。

## 2. Drizzle migration を本番 DB に適用

```bash
sudo -u kagetra bash -c 'cd /opt/kagetra && git pull origin main'
sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm install'

# migration の適用 (0013_familiar_thunderbolt.sql)
sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/shared db:push --force'
```

`db:push` は drizzle-kit が schema diff を直接当てる。本番初回適用後は
`__drizzle_migrations` テーブルに記録される。

## 3. LINE Developers Console で 30 Bot を作成

[LINE Developers Console](https://developers.line.biz/console/) の既存
`kagetra` Provider 配下に、Messaging API channel を 30 個作成する。
所要時間: 約 2.5 時間 (1 Bot あたり ~5 分の手作業)。

各 Bot の設定:

- **Channel 名**: `kagetra-event-bot-1` 〜 `kagetra-event-bot-30`
- **Webhook URL**: `https://new.hokudaicarta.com/api/webhook/line` (全 Bot
  共通)
- **Webhook**: ON
- **Allow bot to join group chats**: ON (これがないとグループ招待で
  Bot が拒否される)
- **Auto-reply messages**: OFF (アプリ側で reply を制御)
- **Greeting messages**: OFF

各 Bot から以下を控える:
- Channel ID
- Channel Secret
- Channel Access Token (long-lived、`Issue` ボタンで発行)
- Basic ID (`@kagetra-event-bot-N`) — friends-add URL 用
- **Bot user ID** (`U` + 32 hex) — webhook routing 用。各 Bot Console
  画面の「Basic settings」→「Your user ID」、もしくは webhook テスト
  時の payload `destination` から取得

これらを JSON 配列にまとめて `/etc/kagetra/broadcast-channels.json` に
配置 (mode 0600, owner kagetra):

```json
[
  {
    "channelId": "2007123456",
    "channelSecret": "deadbeef...",
    "channelAccessToken": "...",
    "botId": "@kagetra-event-bot-1",
    "webhookDestinationId": "U0123456789abcdef0123456789abcdef",
    "note": "kagetra-event-bot-1"
  },
  ...
]
```

`webhookDestinationId` が無いと webhook handler は botId / channelId に
フォールバックするが、LINE は実際には Bot user ID を送ってくるため、
本番では必ず正しい値をセットすること。


## 4. 30 Bot を line_channels テーブルに投入

```bash
sudo -u kagetra bash -c 'cd /opt/kagetra && \
  DATABASE_URL=$(cat .env.production | grep ^DATABASE_URL | cut -d= -f2-) \
  corepack pnpm --filter @kagetra/web exec tsx scripts/seed-broadcast-channels.ts \
    --file=/etc/kagetra/broadcast-channels.json'
```

冪等: 既存の `channel_id` を持つ行はスキップされる。終了時に
`inserted N, skipped M` がログに出る。

確認:

```bash
sudo -u kagetra psql $DATABASE_URL -c \
  "SELECT id, note, status, purpose FROM line_channels WHERE purpose='event_broadcast' ORDER BY id"
```

## 5. systemd timer の配置

```bash
sudo cp /opt/kagetra/apps/web/systemd/kagetra-broadcast-cleanup.service /etc/systemd/system/
sudo cp /opt/kagetra/apps/web/systemd/kagetra-broadcast-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kagetra-broadcast-cleanup.timer

# 動作確認:
systemctl status kagetra-broadcast-cleanup.timer
systemctl list-timers kagetra-broadcast-cleanup.timer
```

JST 04:00 の発火を待たずに即時実行してテストしたい場合:

```bash
sudo systemctl start kagetra-broadcast-cleanup.service
journalctl -u kagetra-broadcast-cleanup.service -n 20 --no-pager
```

## 6. apps/web のリビルド & 再起動

`apps/web` のコードが変わっているので systemd 経由で再起動:

```bash
sudo -u kagetra bash -c 'cd /opt/kagetra && corepack pnpm --filter @kagetra/web build'
sudo systemctl restart kagetra-web.service
```

## 7. Nginx 設定確認

`/api/webhook/line` と `/api/line-broadcast/*` の POST/GET が Next.js に
通過するか確認。標準の `location / { proxy_pass http://localhost:3000; }`
プロキシだけで通るはず — `/api/webhook/line` を明示的に拒否する設定が
無いことだけ確認する:

```bash
sudo nginx -t
curl -X POST -H 'Content-Type: application/json' --data '{}' \
  https://new.hokudaicarta.com/api/webhook/line
# 401 bad_signature を返せば OK (= 200 系で webhook 入口に到達している)
```

## 8. 1 大会で動作確認 (本番初回)

1. 新しい大会の招待メールを受信 → mail-worker が取り込み → AI 抽出
2. `/admin/mail-inbox/[id]` で承認 → events 登録 (この時点では LINE 配信は
   走らない、まだ紐付けされていない)
3. `/events/[id]` を開く → 「LINE 配信」セクション → 「LINE 配信を有効化」
   をタップ → 招待コードモーダル
4. モーダル上の Bot 友だち追加 URL を別端末で開いて Bot を友だち追加
5. LINE で大会参加者グループを作成、`kagetra-event-bot-N` を招待
6. グループで Bot がガイダンスを発言 (「30 分以内に招待コードを発言…」)
7. 招待コード 6 桁を発言 → Bot が「✅ 大会『〇〇大会』と紐付けました」と返信
8. **2 通目以降の大会案内メール** (訂正版・補足連絡) を承認すると、自動で
   LINE グループに配信される
9. `/events/[id]` の配信履歴セクションを確認: 配信済み 1 件、メッセージ数

## 9. 大会終了 +30 日経過後の自動解放確認

大会終了から 30 日経った翌朝 04:00 JST に `kagetra-broadcast-cleanup.timer`
が発火し、`event_line_broadcasts.status='released'` + `line_channels.status='available'`
に戻る。手動確認:

```bash
sudo systemctl start kagetra-broadcast-cleanup.service
journalctl -u kagetra-broadcast-cleanup.service -n 20 --no-pager
# released N broadcasts (ids: ...) と出れば成功
```

`/admin/line-channels` で当該 Bot が空きプールに戻っていることを確認。

## 10. トラブルシュート

### Webhook が来ない / 動かない

- `journalctl -u kagetra-web.service -n 200 --no-pager` で 401/404 ログを
  確認
- 401 bad_signature: LINE Developers Console の Channel Secret が
  `line_channels.channel_secret` と一致しているか確認 (seed JSON のミス)
- 404 unknown_destination: Webhook URL がこの Bot 用の URL になっているか
  確認 (全 Bot 同じ URL 使用)

### 画像が LINE に出ない

- libreoffice / pdftoppm がインストールされているか:
  `pdftoppm -v && libreoffice --version`
- attachment_share_tokens テーブルに該当 token があるか:
  `SELECT * FROM attachment_share_tokens ORDER BY created_at DESC LIMIT 5`
- イメージキャッシュは in-memory で再起動で消える: Bot 配信から 24 時間
  以内に LINE が画像を取りに来る前提なので、再起動後の確認では別画像で

### Bot プール枯渇

- `/admin/line-channels?status=active` で active 数を確認 (25/30 以上で
  警告バナー)
- 大会終了済みの Bot は「強制解放」ボタンで即時返却可能 (24 時間以内に
  使い回す前提なら手動解放)
- 31 Bot 目を追加したい場合は §3-4 をもう一度 (channel_id 重複は seed
  スクリプトがスキップ)

## 11. ロールバック手順

このフィーチャ全体を無効化する場合:

1. `systemctl disable --now kagetra-broadcast-cleanup.timer`
2. `apps/web` の `LineBroadcastSection` を一時的に non-render にする
   (UI のみ; DB スキーマは残しておく)
3. 既存 active Bot の `status='disabled'` 化で配信を止める:
   `UPDATE line_channels SET status='disabled' WHERE purpose='event_broadcast'`
4. 必要なら `events/[id]` 上の "連携解除" を全大会で押す

Migration はロールバック対象外 (空テーブルが残るだけで害なし)。
