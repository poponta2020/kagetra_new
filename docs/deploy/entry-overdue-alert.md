# Deploy: entry-overdue-alert

会内締切超過の未申込大会を管理者個人 LINE へ毎朝通知するバッチの本番反映手順。
既存の `new.hokudaicarta.com`（Oracle Cloud 東京）稼働環境への追加で、単独で実施できる。

前提（[event-lifecycle-notify.md](./event-lifecycle-notify.md) と共通）:
- ホスト TZ は `Asia/Tokyo`（systemd `OnCalendar` がローカル時刻＝JST で評価される）。`timedatectl` で確認。
- アプリは `/opt/kagetra`、実行ユーザーは `kagetra:kagetra`、環境変数は `/opt/kagetra/.env.production`。
- **`line_channels` に `status='system'` の行があり、`notification_line_user_id` が管理者の LINE userId で埋まっている**こと（メール取込アラートで既に使っている経路。未投入なら `apps/mail-worker/scripts/seed-system-channel.ts`）。
- **`PUBLIC_BASE_URL` が `.env.production` に入っている**こと。サマリの各行に大会詳細の絶対 URL を載せるため必須で、未設定だとバッチは exit 1 で止まる（リンクなしの通知を送るより設定漏れに気づかせる方針）。既存の要綱送信（`line-broadcast-guidelines.ts`）が同じ変数を使っているので、通常は既に設定済み。

## 0. scoped sudoers を本番へ配置する（必須・**マージ前が望ましい**）

本機能は新規 systemd unit を 2 本追加する。`infra/sudoers/kagetra-deploy` は unit 名を固定列挙しており（ワイルドカード禁止＝privilege escalation 対策）、**sudoers を本番に反映しないまま unit を含む PR をマージすると、auto-deploy が unit の `install` で sudo に蹴られて fail する**。auto-deploy は sudoers 自身を更新しないため、この手順だけは手で行う。

### 0-a. 必ず「検証 → 配置」の順で行う

**壊れた sudoers を `/etc/sudoers.d/` に置くと、`ubuntu` を含む全ユーザーの `sudo` が使えなくなり、SSH 越しには復旧できない。** 配置前に repo 内のファイルを検証する。

作業中は**別の SSH セッションで root shell を取り、完了まで閉じないこと**。単に別セッションを開くだけでは退路にならない — sudoers が壊れていれば既存・新規どちらのセッションでも `sudo` は通らず、昇格済みのシェルだけが復旧手段になる。

```bash
# 別ターミナルで実行し、§0 が完了するまで閉じない
ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com
sudo -i   # ← このシェルを保持する
```

```bash
# CRLF 混入チェック（1 つでもあれば sudoers 構文エラー。0 であること）
grep -c $'\r' <SRC> || echo "0 (LF only)"

# 構文検証（"parsed OK" を確認してから次へ進む）
sudo visudo -c -f <SRC>
```

`<SRC>` は次節で決まる。**検証が通るまで `install` しない。**

### 0-b. `<SRC>` の決め方（マージ前 / マージ後）

**マージ前**（推奨）— 対象ブランチはまだ存在する。本番 checkout を汚さないよう一時ファイルへ書き出す。`git checkout <ref> -- <path>` は index にも書き込むため、`auto-deploy.sh` 冒頭の作業ツリークリーン検査（`git status --porcelain --untracked-files=no` が空でなければ `tracked local changes present on host` で中断）に引っかかり、次回デプロイが開始直後に必ず失敗する。**`git show` を使うこと。**

**取得失敗と空ファイルを必ず弾くこと。** `> "$SRC"` のリダイレクトは `git show` の実行**前**にファイルを作るため、ブランチ名の誤記やブランチ削除との競合で `git show` が失敗しても空ファイルが残る。**空ファイルは `visudo -c` を通過する**ので、そのまま配置すると `kagetra` の deploy 権限が丸ごと消え、復旧するまで auto-deploy が動かなくなる。

```bash
set -euo pipefail   # §0 のコマンドはこの下で実行する

cd /opt/kagetra
git fetch origin
SRC=$(mktemp)
if ! git show "origin/<ブランチ名>:infra/sudoers/kagetra-deploy" > "$SRC"; then
  rm -f "$SRC"; echo "sudoers source extraction failed" >&2; exit 1
fi
test -s "$SRC" || { rm -f "$SRC"; echo "sudoers source is empty" >&2; exit 1; }
```

**マージ後** — `/ship` がリモートブランチを削除するので上の `git show origin/<ブランチ名>:...` は**失敗する**。マージ後は host の checkout に実体があるのでそれを直接使う。

```bash
cd /opt/kagetra
SRC=/opt/kagetra/infra/sudoers/kagetra-deploy   # git pull 済みなら main の内容
test -s "$SRC"         # 空でないこと
git log --oneline -1   # 目的の unit を含むコミットに達しているか確認
```

### 0-c. 配置

0-a の検証が通ってから実行する。**live ファイルへ直接 `install` しない** — 途中で中断・容量不足になると `/etc/sudoers.d/kagetra-deploy` が部分書き込みのまま残り、そのまま sudo が壊れる。同一ファイルシステム内のステージングファイルへ置いてから `mv` でアトミックに差し替える。ステージング名は**先頭ドット付き**にする（`#includedir` は名前に `.` を含むファイルを読み飛ばすため、途中状態でも sudo に影響しない）。

```bash
STAGE=/etc/sudoers.d/.kagetra-deploy.staging
sudo install -m 0440 -o root -g root "$SRC" "$STAGE"
sudo visudo -c -f "$STAGE"                        # ステージング状態で検証
sudo mv "$STAGE" /etc/sudoers.d/kagetra-deploy    # 同一 fs なのでアトミック
sudo visudo -c -f /etc/sudoers.d/kagetra-deploy   # 配置後の再確認
sudo -n true && echo "SUDO_STILL_WORKS"           # sudo が壊れていないことの確認
if [ "$SRC" != /opt/kagetra/infra/sudoers/kagetra-deploy ]; then rm -f "$SRC"; fi

# 作業ツリーが汚れていないことを確認（空であること）
git status --porcelain --untracked-files=no
```

`SUDO_STILL_WORKS` が出るまで、0-a で確保した root shell を閉じないこと。

### 0-d. allowlist が deploy ユーザーに効いているかの確認

`ubuntu` の全権 sudo で unit を置いてしまうと allowlist の検証にならず、次に systemd unit を触る PR で同じ失敗を繰り返す。**deploy ユーザー（`kagetra`）として**確認する。

**マージ前は `sudo -n -l` でポリシー一致だけを見る。** この時点の本番 checkout はまだ旧 main なので `apps/web/systemd/kagetra-entry-overdue-alert.service` が存在せず、実 install は allowlist が正しくても source missing で失敗する（allowlist 不一致と誤認しやすい）。

```bash
sudo -u kagetra sudo -n -l /usr/bin/install -m 644 -o root -g root \
  /opt/kagetra/apps/web/systemd/kagetra-entry-overdue-alert.service \
  /etc/systemd/system/kagetra-entry-overdue-alert.service && echo ALLOWLIST_POLICY_OK
```

**マージ後**（unit ファイルが checkout に現れてから）は実 install で確認する。これは §3 の手順そのものなので、そちらで兼ねてよい。

```bash
sudo -u kagetra sudo -n /usr/bin/install -m 644 -o root -g root \
  /opt/kagetra/apps/web/systemd/kagetra-entry-overdue-alert.service \
  /etc/systemd/system/kagetra-entry-overdue-alert.service && echo ALLOWLIST_OK
```

いずれも `a password is required` や `not allowed to execute` が出たら allowlist のエントリが一致していない（パスやオプションの綴り違い）。内側の `sudo` に `-n` を付けているので、不一致でも対話プロンプトは出ずエラーで即終了する。

### 0-e. 先に auto-deploy を失敗させてしまった場合の復旧範囲

sudoers 未反映のままマージすると auto-deploy は fail するが、**失敗するのは systemd unit の `install` 段階**である。それより前の工程は完了している:

| 工程 | 状態 |
|---|---|
| `git pull` / `pnpm install` | 完了 |
| build（`.next/standalone` 更新） | 完了 |
| **migration（`db:migrate`）** | **適用済み** |
| systemd unit の install | ← ここで停止 |
| web の restart | 未実行（＝旧コードのまま稼働） |

したがって復旧は **§0（sudoers 配置）→ §3（unit 配置・timer 有効化）→ §2 の `systemctl restart kagetra-web`** で足りる。**migration の再実行も再ビルドも不要**（`.next` の mtime が失敗したデプロイの時刻になっていることで確認できる）。この状態は DB に新 enum があり web が旧コード、という組み合わせだが、旧コードは新しい値を書き込まず既存行も持たないため無害。

なお auto-deploy の `CHANGED` は pull 前後の差分から算出されるため、host が既に `origin/main` に達している状態でワークフローを再実行しても `already up to date` で NOOP になる。**復旧はワークフロー再実行ではなく上記の手順で行うこと。**

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
