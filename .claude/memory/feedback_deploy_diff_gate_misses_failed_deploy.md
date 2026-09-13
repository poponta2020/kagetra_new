---
name: deploy-diff-gate-misses-failed-deploy
description: auto-deployの差分ゲートは失敗デプロイの変更を永久に取りこぼす
type: feedback
---

auto-deploy.sh の `OLD=$(git rev-parse HEAD)` / `NEW=origin/main` の差分ゲートは、**失敗したデプロイの変更を永久に取りこぼす**。

`git checkout -B main origin/main`（L40）が build（L84）**より前**にあるため、build で失敗してデプロイが中断してもホストの HEAD は先に進んでしまう。次回以降の `CHANGED` にはその差分が二度と現れない。

実際に起きたこと（2026-09-10・PR #631）:
1. マージ run 34434065833 が build で失敗（クライアントバンドルに pg が混入。[[quickfix-renewal-client-bundle-and-fk-cleanup]]）→ ホスト HEAD は merge commit へ進んだが migration も unit 配置も restart も未実行
2. 直後の docs コミット（169faa3）のデプロイは `WEB$API$WORKER = 000` で build 自体をスキップし **成功扱い** → HEAD だけさらに前進
3. 結果、`packages/shared/drizzle/0066_minor_black_bolt.sql` と `apps/web/systemd/kagetra-renewal-*.{service,timer}` は今後どの差分にも現れない

**影響の読み方**: build 失敗は「全サービス旧コードのまま継続」という安全側の設計どおりに見えるが、*次の*デプロイが取りこぼす方は安全側ではない。web だけ新コードで再起動され、DB は旧スキーマのままという**不整合状態を作る**。

**確認手順**: デプロイが失敗したら、そのコミットに `packages/shared/drizzle/*.sql` や `apps/*/systemd/` が含まれていなかったかを必ず確認する。含まれていたら手動適用が要る（`apply-migrations.sh` は hash 冪等なので再実行して安全）。

**恒久対策の案（未実施）**: ①成功したデプロイのコミットを state ファイルに記録して OLD に使う ②migration はビルドしたときに常に実行する（journal hash で冪等）③unit は配置先が無ければ install する。ただし ②③ は先に `/etc/sudoers.d/kagetra-deploy` を本番へ反映しないと install が sudo に蹴られて**毎回デプロイが詰まる**ため、sudoers 反映が前提。
