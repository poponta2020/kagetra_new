---
name: project_auto_deploy
description: 本番自動デプロイ (GitHub Actions + SSH) の構成・状態。PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ac76341-fb6b-44c8-9630-2b9826cb7193
---

main push 後に CI 通過を待って本番 (Oracle Cloud `new.hokudaicarta.com`) へ即時自動デプロイする仕組み。2026-06-01 にユーザー依頼で構築。**「できるだけ即時」希望 + repo が public のため、self-hosted runner（fork PR 任意コード実行リスクで非推奨）は不採用、Actions + SSH 方式を採用。**

- **稼働中 (ACTIVE)**: PR #86 merge 済 (merge commit `7d15042`, 2026-06-01)。初回自動デプロイ run も成功（.github/scripts のみ変更 → SKIPPED_NOCODE で疎通確認）。以後 main への code 変更 push は自動で build→migration→restart、docs のみは skip
- **有効化の前提だった #85 (event-lifecycle-notify) も本番反映済** (2026-06-01): migration 0017 適用 (apply-migrations.sh, applied=1/skipped=17) + web rebuild/restart + `kagetra-lifecycle-reminders.timer` を **`enable` のみ**で設置（`--now` は Requires= 経由で即リマインド発火するため回避、次回 00:00 JST）。dry-run 検証 0 candidates。手動デプロイは `C:/tmp/kagetra-deploy-85.sh`（ubuntu 実行・detached）
- **構成 (PR #86 でマージ済)**: worktree は `C:/tmp/impl-auto-deploy`（cleanup 可）
  - `.github/workflows/ci.yml` に `deploy` job: `needs: ci` + `if: push && main`、`concurrency: production-deploy`、deploy 鍵+pinned known_hosts を secrets から構成、接続失敗のみ最大3回リトライ
  - `scripts/deploy/auto-deploy.sh`: host 上で `ssh kagetra@host 'bash -s' < script`。git fetch→変更パス検知(web/api/worker/shared)→pnpm install→build→**drizzle 変更時は apply-migrations.sh で migration 適用(冪等,restart 前)**→静的cp(web)→restart→healthcheck。docs/.claude のみ変更は SKIPPED_NOCODE。build/migration 失敗時は restart せず旧コード継続
  - `.gitattributes`: `*.sh` を LF 固定（CRLF だと bash 流し込みで壊れる）
- **ホスト側設定（実施済・検証済）**:
  - CI 公開鍵 `kagetra-ci-deploy` を `/opt/kagetra/.ssh/authorized_keys` に接続制限付き(no-pty 等)で登録。秘密鍵は `~/.ssh/kagetra-ci-deploy`(ローカル) + GitHub Secrets `DEPLOY_SSH_KEY`
  - `/etc/sudoers.d/kagetra-deploy`: `kagetra` が `systemctl restart/is-active kagetra-web/api` のみ NOPASSWD（**PR #132 で大幅拡張**: 12 unit の `install`（固定 source+dest）+ `daemon-reload` + `enable --now`/`restart`/`is-active` を追加。**ワイルドカード `kagetra-*` は不使用**（privilege escalation 経路）。repo `infra/sudoers/kagetra-deploy` で版管理、本番への配置は手動 `install -m 0440` で実施）
  - Secrets: `DEPLOY_SSH_KEY` / `DEPLOY_SSH_KNOWN_HOSTS`（host 鍵 pin）
  - `kagetra` は /bin/bash でログイン可・home=/opt/kagetra・repo 所有者。DATABASE_URL は `/opt/kagetra/.env.production`
- **ビルド対象判定の拡張 (PR #137, 2026-06-11, Issue #135)**: WEB 判定は `^apps/(web|mail-worker)/`（web は mail-worker の TS ソースを transpilePackages でバンドルするため）、`pnpm-lock.yaml` 変更は SHARED=1（全アプリ再ビルド）。経緯: PR #134 (mail-worker のみ) で web=0 → 本番の再抽出 Server Action が旧 classifier のまま残留。**transpilePackages に package を足すときは auto-deploy.sh の WEB 判定も同時更新**（next.config.ts にコメント明文化済み）。deploy script のみの修正 PR は SKIPPED_NOCODE になるため、本番修復を同梱するには web 配下の実ファイル変更を含めること
- **systemd unit 自動配置 (PR #132, 2026-06-10)**: auto-deploy.sh が `apps/*/systemd/kagetra-*.{service,timer}` の差分を検出して自動 `install` + `daemon-reload` + (timer なら `enable --now` + `restart` + `is-active`)。**新規 unit を追加するなら infra/sudoers/kagetra-deploy にも対応エントリを追記し本番再配置必須**（未登録 unit は install で sudo 蹴られて即 fail = 攻撃ベクトル無し）。.service には `User=kagetra` / `Group=kagetra` の defensive check 付き。trust model = 1 人開発 + main push = deploy 認可（kagetra writable source からの root install は理論上残るが信頼境界として許容）。経緯: Issue #131 で PR #127 の extract timer 未配置による多摩大会 AI 抽出永遠停滞を契機に追加
- **マージ保留の理由（整合性優先）**: main に並行作業 [[impl_event_lifecycle_notify]] (#85) が **migration 0017 + systemd timer 込み**でマージ済・本番未反映。#86 をマージすると次の main push で #85 の web コード+migration **だけ**が自動投入され、**reminder timer (`docs/deploy/event-lifecycle-notify.md` の手動 step) が入らず中途半端**になる。→ **#85 を専用 doc 通り本番投入した後に #86 をマージ**して有効化する
- **接続の罠**: 一部環境（IPv6/NAT64）から **IPv4 リテラル `140.238.51.41` は到達不可**。**ホスト名 `new.hokudaicarta.com` 経由なら可**（初回 cold 接続は timeout しがち→リトライ）。GitHub Actions runner は通常 IPv4 なので直接到達可（SSH(22) は iptables で 0.0.0.0/0 key-only 公開済、firewall 変更不要だった）

関連: [[impl_mail_body_as_image]]（手動デプロイで本番反映の手順を実証）、[[feedback_no_shared_maindir_for_branch_work]]、[[project_production_deploy]]
