---
name: reference_prod_db_tunnel_connect
description: ローカル dev web を本番 PostgreSQL に SSH トンネル経由(:5435)で接続する手順
metadata:
  type: reference
---

ローカルの dev web(apps/web) を**本番 DB** に向ける手順（本番データを画面で見る/点検する用）。⚠️ read-write なので**画面操作は本番に反映される**。**セッション限り**：トンネルは切断で消える、`.env.local` は終わったら必ず戻す。

- 本番 postgres は Oracle Cloud VM 内で `127.0.0.1:5432` バインド（外部非公開）。到達は SSH トンネルのみ。
- ローカル 5432 は他プロセスで埋まっていることがある → **5435** を使う（dev DB は docker で 5433/5434）。
- トンネル（background）: `ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 127.0.0.1:5435:127.0.0.1:5432 ubuntu@new.hokudaicarta.com`。鍵はパスフレーズ無し・`ubuntu` は NOPASSWD sudo 可。
- PW 取得（実行時・**ハードコード禁止**）: `ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes ubuntu@new.hokudaicarta.com 'sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD'`。
- `apps/web/.env.local` の `DATABASE_URL` を `postgresql://kagetra:<PW>@127.0.0.1:5435/kagetra?sslmode=disable` に切替（gitignore 済み・元値はコメントで残し即 revert）。**host は `127.0.0.1`**（`localhost` は IPv6 解決で docker pg に ECONNRESET）。**PW は git 追跡ファイルや応答に出さない**。
- 検証: pane を使わず `node`+pg で `select count(*) from players`（本番は約 4.8 万件）や `curl /api/auth/session` で確認。web は起動時に `.env.local` を読むので切替後は preview を再起動。
- 接続情報の正典 = `c:/tmp/HANDOVER_bulk_load.md`（host `new.hokudaicarta.com`、SSH 鍵、コンテナ名 `kagetra-postgres`、DB/user=`kagetra`）。本番構成は [[project_production_deploy]]。

pane でログイン後画面を見る手順は [[reference_inapp_pane_app_view]]（`/show-app prod`）。
