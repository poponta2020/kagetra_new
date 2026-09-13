# Deploy: annual-registration-renewal（年度確認）

年度確認機能の本番反映手順。既存の `new.hokudaicarta.com`（Oracle Cloud 東京）稼働環境への追加で、
単独で実施できる。新規 systemd timer を **2 本**追加し、新しい env を **1 つ**必要とする。

前提（[entry-overdue-alert.md](./entry-overdue-alert.md) と共通）:

- ホスト TZ は `Asia/Tokyo`（systemd `OnCalendar` がローカル時刻＝JST で評価される）。`timedatectl` で確認。
- アプリは `/opt/kagetra`、実行ユーザーは `kagetra:kagetra`、環境変数は `/opt/kagetra/.env.production`。
- **`line_channels` に `status='system'` の行があり、`notification_line_user_id` が管理者の LINE userId で埋まっている**こと（送信タスクの失敗・要確認・セッション警告の通知先。既存のメール取込アラートと同じ経路）。
- **`PUBLIC_BASE_URL` が `.env.production` に入っている**こと。案内・リマインドの本文に `/renewal` の絶対 URL を載せるため必須で、未設定だと**年度確認の開始そのものが拒否される**（AC-3）。既存の要綱送信が同じ変数を使っているので通常は設定済み。

## 0. scoped sudoers を本番へ配置する（必須・**マージ前が望ましい**）

> **状態: 2026-09-13 に反映済み**（`visudo -c` parsed OK / `440 root:root`）。
> ただし初回反映分には timer の `is-active` 2 行が漏れており、PR #641 で追加して再反映している
> （漏れを機械的に検出するテスト = `apps/web/scripts/__tests__/systemd-sudoers.test.ts`）。
> 以降 `infra/sudoers/kagetra-deploy` を変えたときだけ この手順を再実施する。

本機能は新規 systemd unit を 4 ファイル（2 timer + 2 service）追加する。
`infra/sudoers/kagetra-deploy` は unit 名を固定列挙しており（ワイルドカード禁止＝privilege escalation 対策）、
**sudoers を本番に反映しないまま unit を含む PR をマージすると、auto-deploy が unit の `install` で sudo に蹴られて fail する**。
auto-deploy は sudoers 自身を更新しないため、この手順だけは手で行う。

本 PR で追記済みのエントリ:

```
install: kagetra-renewal-reminders.service / .timer
         kagetra-renewal-school-year.service / .timer
systemctl enable --now / restart: kagetra-renewal-reminders.timer
                                  kagetra-renewal-school-year.timer
```

手順そのもの（退路の確保・`visudo -c` での検証・`git show` での取得・空ファイルの排除）は
**[entry-overdue-alert.md §0](./entry-overdue-alert.md) と完全に同じ**なので、そちらをそのまま実施する。
`<ブランチ名>` を `feature/annual-registration-renewal` に読み替えるだけでよい。

> **壊れた sudoers を `/etc/sudoers.d/` に置くと全ユーザーの `sudo` が使えなくなる。**
> 作業中は別 SSH セッションで `sudo -i` の root shell を保持し、完了まで閉じないこと。

## 1. env を追加する

`.env.production` に**新しく 1 行**加える。

```sh
# annual-registration-renewal: /api/line-chat-worker/** のサービストークン。
# kagetra 専用で、match-tracker の他の連携キー（EXTERNAL_ENTRANTS_API_KEY）とは共有しない。
LINE_CHAT_WORKER_TOKEN=<十分に長いランダム文字列>
```

生成例:

```bash
openssl rand -base64 48 | tr -d '\n'
```

- 未設定・空文字なら**全リクエストが 403 で落ちる**（fail-closed）。コードだけ先に本番へ出ても壊れないので、デプロイ順序の制約は無い。
- **URL クエリでは絶対に渡さない**（nginx access log に残る）。受け口は `X-Service-Token` ヘッダのみ。
- 反映は `kagetra-web.service` の restart が必要（systemd `EnvironmentFile` は起動時に読まれる）。auto-deploy が毎回 restart するので、通常は次のデプロイで自動的に効く。

## 2. マージ → auto-deploy

`main` へマージすると GitHub Actions の deploy が走り、変更されたパスに応じて以下を行う:

- migration `0066_minor_black_bolt.sql` の適用（`apply-migrations.sh`）
- `apps/web/systemd/kagetra-renewal-*.{service,timer}` の `/etc/systemd/system/` への配置
- `daemon-reload` → 新規 timer の `enable --now` → `restart`
- `kagetra-web.service` の restart

> **⚠️ 2026-09-10 の初回マージ（PR #631）ではこれらは実行されなかった。**
>
> deploy は build で失敗し（クライアントバンドルへ `pg` が混入し `Module not found: 'net'`。
> 修正 = PR #638）、build は migration よりも unit 配置よりも**前**にあるため以降が全て未実行になった。
> さらに `auto-deploy.sh` は `OLD=$(git rev-parse HEAD)` と `origin/main` の差分で適用対象を決めるが、
> `git checkout` が build より**前**にあるため、失敗してもホストの HEAD は先に進む。
> 結果として **0066 と unit の差分は以降のどのデプロイにも現れなくなった**。
>
> 2026-09-13 に以下を手作業で実施済み（同じ事態が再発したときはこの手順を使う）:
>
> ```bash
> # ① 先にバックアップを 1 回走らせる
> sudo systemctl start kagetra-backup.service
> # ② migration を適用（journal+hash で冪等。適用済みは SKIP される）
> sudo -u kagetra bash -c 'DB_URL=$(grep -E "^DATABASE_URL=" /opt/kagetra/.env.production | head -1 | sed -E "s/^DATABASE_URL=//; s/^\"(.*)\"$/\1/") >   DATABASE_URL="$DB_URL" bash /opt/kagetra/scripts/deploy/apply-migrations.sh'
> # ③ unit を配置（sudoers 反映後。kagetra に限定された install 権限を使う）
> sudo -u kagetra sudo -n /usr/bin/install -m 644 -o root -g root >   /opt/kagetra/apps/web/systemd/<unit> /etc/systemd/system/<unit>
> sudo systemctl daemon-reload
> sudo systemctl enable --now kagetra-renewal-reminders.timer kagetra-renewal-school-year.timer
> ```
>
> **教訓**: デプロイが失敗したら、そのコミットに `packages/shared/drizzle/*.sql` や `apps/*/systemd/` が
> 含まれていなかったかを必ず確かめること。含まれていたら手動適用が要る。
> （CI に `pnpm build` を入れたので、クライアント・サーバー境界違反による build 失敗は以降 PR 段階で止まる）

## 3. デプロイ後の確認

### 3-a. timer が有効になっているか

```bash
systemctl list-timers 'kagetra-renewal-*'
```

`kagetra-renewal-reminders.timer`（毎日 19:30）と `kagetra-renewal-school-year.timer`（毎日 00:05）の
2 本が `NEXT` 付きで並ぶこと。

### 3-b. バッチを dry-run で叩く（何も書き換えない）

```bash
sudo -u kagetra bash -lc 'set -a; . /opt/kagetra/.env.production; set +a; cd /opt/kagetra && corepack pnpm --filter @kagetra/web exec tsx scripts/renewal-daily.ts --reminders --dry-run'
```

```bash
sudo -u kagetra bash -lc 'set -a; . /opt/kagetra/.env.production; set +a; cd /opt/kagetra && corepack pnpm --filter @kagetra/web exec tsx scripts/renewal-daily.ts --apply-school-year --dry-run'
```

`--dry-run` は候補を列挙するだけで、タスク作成・LINE API 呼び出し・`users` の更新のいずれも行わない。
年度確認をまだ開始していない時期は「進行中の年度確認なし」で終わるのが正常。

### 3-c. ワーカー API が閉じているか（fail-closed の確認）

```bash
# トークン無し → 401
curl -s -o /dev/null -w '%{http_code}\n' https://new.hokudaicarta.com/api/line-chat-worker/tasks
# 不正なトークン → 403
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Service-Token: wrong' https://new.hokudaicarta.com/api/line-chat-worker/tasks
# 正しいトークン → 200（会 LINE グループ未設定なら本文は []）
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Service-Token: $LINE_CHAT_WORKER_TOKEN" https://new.hokudaicarta.com/api/line-chat-worker/tasks
```

### 3-d. 画面から会 LINE グループを設定する

`設定 › 会 LINE グループ`（admin / vice_admin）で:

1. プールの Bot を 1 体選ぶ（選んだ時点で大会・級別の配信候補から外れる）
2. その Bot を会の LINE グループに招待する
3. グループで誰かが一言発言する（OAM にルームが現れる）
4. LINE Official Account Manager でそのルームを開き、URL（`https://chat.line.biz/U…/chat/C…`）と
   グループ表示名を貼って保存する

**グループ ID の捕捉**（メンションに必要）は、Bot が招待された `join` webhook でしか起きない。
画面の badge が「未捕捉」のままなら、Bot を一度グループから外して招待し直す。
未捕捉のままでもリマインドは送られる（未回答者を氏名テキストで列挙する形にフォールバックする）。

## 4. match-tracker 側（別リポジトリ・年度確認の開始前までに）

実際の送信は kagetra ではなく match-tracker の常駐ワーカー `line-chat-worker`（同一 VM・Playwright）が行う。
kagetra だけをデプロイした状態でも**壊れない**（作られた送信タスクが `PENDING` のまま残るだけ）が、
実際に LINE へ流すには match-tracker 側の対応が要る。

- `line-chat-worker` を複数アプリ対応にし、`APPS_JSON` に kagetra のエントリ（`baseUrl` / `token` / `accountPath`）を足す
- VM の `.env` を更新してワーカーを再起動する
- メンション（`@` 候補選択）は PoC ゲート付き。不成立ならメンションなし（全員テキスト列挙）で運用する

詳細は match-tracker リポジトリの `line-chat-worker/RUNBOOK.md` を参照。

## 運用メモ

- **リマインドの作り方**: 19:30 の バッチがその時点の未回答者を集計し、同日 20:00 の送信タスクを作る。
  対象日は「開始日 +3 日ごと」「締切前日」「締切当日」。未回答が 0 人なら作らない。
- **20:00 の 5 分前を過ぎた起動では作らない**（ホスト停止からの catch-up 起動で過去分を送りつけないため）。
  その日のリマインドは送られず、次の対象日に改めて集計される。
- **失敗・要確認は管理者個人 LINE へ通知**される（グループへの push フォールバックはしない）。
  再試行は `設定 › 会 LINE グループ` の送信タスク一覧から、**送信予定が未来のタスクだけ**行える。
- **学年の反映は 4/1 以降**。00:05 のバッチが `school_year_applied_at IS NULL` の行を CAS で反映する。
  年度確認が「登録完了」になっていても反映は続く（登録完了は 5 月、学年は 4/1 という別の期日のため）。
