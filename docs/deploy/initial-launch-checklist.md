# Phase D: 本番初回起動 checklist

kagetra_new 本番 (`https://new.hokudaicarta.com`) を Phase A-C 配線完了後、運用開始 (= ship 宣言) する前に通す動作確認チェックリスト。各項目を **手元で実施 + 結果記録** することで本番運用の自信を得る。

このファイルは継続的に更新する: 新機能追加時は対応項目を追記する。

## 0. 前提 (Phase A-C 完了済)

- ✅ Oracle Cloud インスタンス起動済、Public IP 確定、SSH 接続可
- ✅ DNS (Lightsail DNS zone) で `new.hokudaicarta.com` → instance IP 解決
- ✅ Let's Encrypt SSL 取得済、`certbot.timer` active
- ✅ `/opt/kagetra/.env.production` 配置済 (mode 0600, owner kagetra)、TODO 値ゼロ
- ✅ postgres docker 起動 + 12 migrations 適用済
- ✅ apps/web + apps/api + nginx 配線済
- ✅ admin seed 済、LINE 紐付け済 (`SELECT line_user_id FROM users WHERE role='admin'`)
- ✅ mail-worker systemd timer enable + `line_channels` system seed 済
- ✅ backup systemd timer enable + 手動 trigger で R2 にオブジェクト確認済

> 上記が ✅ になっていなければ Phase A-C のいずれかが未完了。docs/deploy/{oracle-setup,dns-ssl,postgres,web,api,mail-worker,backup}.md に戻る。

---

## 1. 認証 / セッション

### 1.1 LINE ログイン → dashboard 表示

- [ ] PC ブラウザで **新規シークレットウィンドウ** を開き `https://new.hokudaicarta.com/` にアクセス
- [ ] `/auth/signin` にリダイレクトされ、緑の「LINE でログイン」ボタンが表示される
- [ ] LINE 認証 → 「許可」→ コールバック → `/self-identify` or `/dashboard` のいずれかに到達
- [ ] (初回時) `/self-identify` で自分の名前を選択 → `/dashboard` へ
- [ ] dashboard に自分の名前と role (admin) が表示される

### 1.2 サインアウト

- [ ] dashboard などからサインアウト操作 (UI が露出している箇所)
- [ ] 未認証状態 (`/auth/signin` に戻る) が確実に再現される
- [ ] サインアウト直後に protected path (e.g. `/dashboard`) を URL バーから直叩きしても `/auth/signin` に戻る

### 1.3 招待制ガード (admin 未承認 LINE userId のブロック)

- [ ] **未招待の LINE アカウント** (別の LINE userId) でアクセスしてみる
  - 例: テスト用 LINE アカウントがあれば使う、無ければ将来の招待時に確認
- [ ] sign in は通過するが `/self-identify` 候補リストが空 (`isInvited=true` + `lineUserId IS NULL` の行が無い) → 自己紐付け不可
- [ ] DB に `isInvited=true` の招待行を 1 つ追加 (admin が UI から or SQL で) → 再度サインインで紐付けできることを確認

### 1.4 403 (権限なし) ガード

- [ ] 一般会員 role でログイン (テスト会員を 1 つ作って下げる、or DB で role=member に書き換え)
- [ ] `/admin/members` 等の admin 専用 path を直 URL で叩く → 403 / アクセス拒否ページに到達
- [ ] role を admin に戻す

---

## 2. イベント機能 (Phase 1 主要機能)

### 2.1 一覧 + 作成

- [ ] `/events` で公開済イベント一覧 (今後分) が表示される (空でも OK)
- [ ] `/events/new` でイベント新規作成 (タイトル / 日付 / 場所 / 締切 等)
- [ ] 作成後リダイレクト先で詳細表示される
- [ ] `/events` 一覧に作成イベントが現れる

### 2.2 詳細 + 出欠回答

- [ ] 一覧から詳細ページに遷移
- [ ] 「参加」「不参加」「検討中」等の出欠回答ボタンが表示される
- [ ] 回答 → トースト等の成功フィードバック → 自分の回答が表示される
- [ ] 別の選択肢に変更 → 上書きされる
- [ ] DB 確認: `SELECT * FROM event_attendances WHERE event_id = N` で行が存在 + 更新時間が反映

### 2.3 編集 + 締切後の挙動

- [ ] `/events/[id]/edit` でイベント編集 (締切日を**過去日**に変更)
- [ ] 一覧 or 詳細で「締切済」「回答受付終了」等の表示に変わる (※ 仕様次第)
- [ ] 締切後に出欠回答ボタンを操作 → サーバ側で拒否 or UI 上で disable

### 2.4 アーカイブ

- [ ] `/events-archive` で過去イベント一覧が表示される
- [ ] 今後分とアーカイブの境界が日付 (event_date < today) で正しく切られている

---

## 3. スケジュール機能

### 3.1 一覧 + 作成

- [ ] `/schedule` でスケジュール一覧 (空でも可)
- [ ] `/schedule/new` でスケジュール作成 (タイトル / 日付 / kind 等)
- [ ] 作成後リダイレクト → 一覧に現れる

### 3.2 詳細 + 編集 + 削除

- [ ] `/schedule/[id]` 詳細表示
- [ ] `/schedule/[id]/edit` で内容変更 → 反映確認
- [ ] 削除 → 一覧から消える + DB 行も消える (or soft delete 仕様確認)

---

## 4. 管理機能

### 4.1 メンバー管理

- [ ] `/admin/members` でメンバー一覧 (招待済 + 紐付け済 + 未紐付け の表示確認)
- [ ] `/admin/members/[id]/edit` で grade / role 変更 → 反映
- [ ] 新規招待行を作成 (UI から or SQL `INSERT INTO users(...) VALUES(... is_invited=true, line_user_id=NULL)`)
- [ ] 一覧で「招待中・未紐付け」状態の表示確認

### 4.2 mail-inbox (mail-worker と連携)

- [ ] `/admin/mail-inbox` で取り込み済メール一覧が表示される
- [ ] mail-worker が一度回ったあとなら最低 1 件は表示されるはず
- [ ] 「最近の取り込み履歴」セクションで `mail_worker_runs` の結果 (success / fetched=N / drafts=N) が見える
- [ ] tournament 判定された draft を 1 件選んで内容確認 → 承認 → DB の event/tournament_draft 状態確認
- [ ] 「メール取り込み」ボタンで手動 trigger → トースト表示 → 数秒〜30 秒で履歴反映

### 4.3 LINE link 管理 (account switch)

- [ ] `/settings/line-link` で現状の LINE 紐付け情報が表示される
- [ ] 別 LINE アカウントへの切り替えフロー (admin/account switch) を実施
- [ ] DB 確認: `line_link_method` が `self_identify` → `account_switch` 等に更新される

---

## 5. mail-worker (timer 駆動)

### 5.1 timer 動作確認

- [ ] `systemctl list-timers | grep kagetra-mail-worker` で次回 firing 時刻が見える (30 分以内)
- [ ] 次回 firing 時刻を待つ or 手動 trigger (`sudo systemctl start kagetra-mail-worker.service`)
- [ ] `journalctl -u kagetra-mail-worker.service -n 50` で pipeline summary が出力されている
- [ ] `pipeline summary` の status が異常 (failed > 0 / errors にエントリ) でないこと

### 5.2 DB 確認

```sql
SELECT id, status, started_at, finished_at,
  summary->>'fetched' AS fetched,
  summary->>'inserted' AS inserted,
  summary->>'drafts_inserted' AS drafts
FROM mail_worker_runs ORDER BY id DESC LIMIT 5;
```

- [ ] 直近 5 run が `status='success'` で、fetched / inserted / drafts_inserted が連続して反映されている
- [ ] `mail_messages` テーブルに行が増えている (`SELECT count(*) FROM mail_messages`)

### 5.3 添付処理

- [ ] PDF 添付ありメールが取り込まれた場合の `mail_attachments` 行の `extraction_status` が `extracted` or `unsupported` で死んでいない
- [ ] `attachment_text` が PDF の場合に抽出文字列を含む

---

## 6. backup (timer 駆動 + 通知)

### 6.1 timer 動作確認

- [ ] `systemctl list-timers | grep kagetra-backup` で次回 firing 時刻 (03:00 JST = 18:00 UTC)
- [ ] 手動 trigger (`sudo systemctl start kagetra-backup.service`) で一度走らせる
- [ ] `journalctl -u kagetra-backup.service -n 100` で全 stage 完走 (`all stages completed successfully`)
- [ ] **直前の手動 trigger の rclone ログに `INFO : ...-...-...dump: Copied (new) to: kagetra-YYYY-MM-DD.dump`** が見える

### 6.2 R2 への upload 確認

- [ ] Cloudflare Dashboard → R2 → `kagetra-backup` → `daily/` で当日 dump が存在
- [ ] CLI 確認 (`rclone lsf R2:kagetra-backup/daily/ --format pt`) でも当日 dump が listing される

### 6.3 失敗通知テスト (LINE notify-system 経路)

- [ ] `/opt/kagetra/.env.production` の `R2_BUCKET` を一時的に存在しない値に書き換え (`sudo -u kagetra sed -i 's/^R2_BUCKET=.*/R2_BUCKET=nonexistent-bucket-test/' /opt/kagetra/.env.production`)
- [ ] `sudo systemctl start kagetra-backup.service` で手動 trigger → 失敗
- [ ] `journalctl -u kagetra-backup.service` に `[notify-system] pushed` ログ
- [ ] LINE Bot から失敗通知が admin に届く
- [ ] `R2_BUCKET` を `kagetra-backup` に戻して再度 trigger → 正常完了

### 6.4 fallback 通知テスト (DB 障害シナリオ)

- [ ] postgres container を停止 (`cd /opt/kagetra && sudo docker compose -f docker/docker-compose.prod.yml stop postgres`)
- [ ] `sudo systemctl start kagetra-backup.service` で手動 trigger → pre_check stage で失敗
- [ ] journal に `[notify-fallback] pushed` が出る (`[notify-system]` ではなく fallback)
- [ ] LINE Bot から fallback 経由の失敗通知が届く
- [ ] postgres を再起動 (`sudo docker compose -f docker/docker-compose.prod.yml start postgres`) → 手動 trigger で正常終了

### 6.5 復元 drill (任意、本番初回 ship 前に 1 回は推奨)

- [ ] R2 から daily dump を `/tmp/restore.dump` にダウンロード (`docs/deploy/backup.md` §8 参照)
- [ ] **別 DB / 別 container** に restore してみる (本番 DB に直接戻さない)
- [ ] restore 先で `SELECT count(*) FROM users; SELECT count(*) FROM events;` 等で件数確認
- [ ] sha256sum で local dump (`/var/backups/kagetra/daily/kagetra-YYYY-MM-DD-...dump`) と R2 から落とした dump の hash 一致

### 6.6 家 PC 副コピー

- [ ] 家 PC で R2 read-only token を発行 (本番 backup 用とは別)
- [ ] `rclone copy r2:kagetra-backup/monthly/ ~/backup/kagetra/monthly/` を試走
- [ ] 月 1 回のリマインダ設定 (個人 calendar 等)

---

## 7. SSL / 証明書

### 7.1 期限確認

- [ ] `sudo certbot certificates` で `new.hokudaicarta.com` の証明書が listing される
- [ ] expiry が 60+ 日後 (取得直後なら 89 日後) であることを確認

### 7.2 自動更新 simulation

- [ ] `sudo certbot renew --dry-run` で simulation 成功 (実際の取得はしない、検証だけ)
- [ ] `systemctl list-timers | grep certbot` で `certbot.timer` が active、次回 firing が 12 時間以内

### 7.3 HTTPS / HSTS 確認

- [ ] `curl -I https://new.hokudaicarta.com` で HTTP/2 200 が返る
- [ ] `curl -I http://new.hokudaicarta.com` で `301 Moved Permanently` (HTTPS redirect)
- [ ] (任意) HSTS を有効にしたい場合は nginx に `add_header Strict-Transport-Security ... always;` を追記

---

## 8. モバイル UX (スマホ実機確認、必須)

### 8.1 主要ページのモバイル表示

- [ ] スマホ (Android / iPhone どちらか) で実機アクセス
- [ ] `/` → `/auth/signin` 自動遷移、LINE ボタン押しやすいサイズ
- [ ] LINE 認証 → dashboard 表示、スクロール / タップ違和感なし
- [ ] `/events` 一覧、`/events/[id]` 詳細、出欠回答ボタンが指で押せる
- [ ] `/schedule` 一覧、`/schedule/[id]` 詳細
- [ ] `/admin/mail-inbox` (admin 機能だが PC 想定) → モバイルでも崩壊しない
- [ ] viewport が `width=device-width` で文字が小さすぎない / 横スクロール無し

### 8.2 LINE アプリ内ブラウザでの動作

- [ ] LINE トーク内のリンクから開いた状態 (LINE in-app browser) でも login / 操作可能
- [ ] LINE で送ったリンク (例: `https://new.hokudaicarta.com/events/N`) をタップ → in-app browser → ログイン誘導 → 復帰

---

## 9. パフォーマンス / リソース

### 9.1 レスポンス時間

- [ ] `curl -w "%{time_total}\n" -o /dev/null -s https://new.hokudaicarta.com/dashboard` を 5 回連続実行
- [ ] 平均 1.5 秒以下、最大 3 秒以下 (初回コールド or warm 含めて)
- [ ] `/hono-api/health` は 100ms 以下が期待値

### 9.2 メモリ / disk

- [ ] `free -h` で Memory used が 8GB 以下、swap 使用量が 100MB 以下
- [ ] `df -h /` で disk usage が 70% 以下
- [ ] `du -sh /var/backups/kagetra/` で local backup 容量が想定 (~50MB × 8 file = 400MB) 以内
- [ ] `du -sh /opt/kagetra/` で repo + node_modules が 5GB 以下 (pnpm + ARM build で大きめ)

### 9.3 oncall 一覧

- [ ] `systemctl status kagetra-web.service` → active (running)
- [ ] `systemctl status kagetra-api.service` → active (running)
- [ ] `systemctl status nginx.service` → active (running)
- [ ] `systemctl is-active kagetra-mail-worker.timer` → active
- [ ] `systemctl is-active kagetra-backup.timer` → active
- [ ] `systemctl is-active certbot.timer` → active
- [ ] `docker ps` に `kagetra-postgres` が `(healthy)` で表示
- [ ] (任意) reboot drill: `sudo reboot` → 5 分待って全 service が自動復帰 (`Persistent=true` で timer の missed firing も catch-up)

---

## 10. ship 宣言

すべての ☑ が埋まったら、`docs/worklog.md` に以下を追記して ship を宣言する:

```markdown
- 20YY-MM-DD Phase D ship: kagetra_new 本番稼働開始 (`https://new.hokudaicarta.com`)
  - 初回 admin: <name> (LINE 紐付け済)
  - 動作確認: initial-launch-checklist.md 全項目 ☑
  - 並行稼働: 旧 kagetra (`hokudaicarta.com`) と当面継続、ドメイン cutover は将来別 PR
```

合わせて `.claude/memory/project_production_deploy.md` の Phase D セクションを「ship 完了」に更新する。

## 関連 file

- `docs/deploy/README.md` — Phase 全体構成
- `docs/deploy/oracle-setup.md` / `dns-ssl.md` / `postgres.md` / `web.md` / `api.md` / `mail-worker.md` / `backup.md` — 各 Phase の手順詳細
- `apps/mail-worker/scripts/seed-system-channel.ts` — LINE Bot 初期登録
- `apps/web/scripts/seed-initial-admin.ts` — 初期 admin seed
- `scripts/deploy/apply-migrations.sh` — DB migration 適用
- `scripts/deploy/backup.sh` — daily backup
