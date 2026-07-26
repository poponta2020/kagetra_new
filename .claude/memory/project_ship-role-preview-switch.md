---
name: ship-role-preview-switch
description: 'shipped: PR #336'
metadata:
  type: project
---

# role-preview-switch 出荷記録

PR #336 https://github.com/poponta2020/kagetra_new/pull/336
「feat(role-preview): 管理者が表示ロールを一般会員/副管理者へ切り替えて実機確認できるようにする」

親 Issue #327 / 子 #328-#332（PR 本文の closing keyword でマージ時に自動クローズ）。
実装の詳細は [[impl-role-preview-switch]]、レビューラウンドは [[auto-review-round-pr336]]。

## 出荷したもの
環境変数 `ROLE_PREVIEW_USER_IDS` の許可リストに載ったユーザーだけが、設定シートから
表示ロールを 管理者 / 副管理者 / 一般会員 へ落として実機確認できる。UI の出し分けだけ
でなく Server Action / route handler の認可も切替後のロールで判定される。DB スキーマ
変更・migration なし（状態は JWT クレーム `viewAsRole` 1 個）。

実効ロールの生成点は `auth.config.ts` の session コールバック 1 箇所で、`session.user.role`
を読む既存 41 ファイル・162 箇所は無変更のまま追従する。本物のロールは
`session.user.realRole` として別に公開し、**切替・復帰の認可には realRole だけを使う**
（実効ロールで判定するとプレビュー中に自分を締め出す）。

## レビュー
auto-review-loop 2R・effort=high→high・累計 351,455 / 500,000 tokens・R2 verdict=pass。
R1 で認証の中核に blocker 2 件（詳細は [[auto-review-round-pr336]]）。
最重要は **Auth.js の `POST /api/auth/session` が許可リストを迂回できた**件。

## 検証
全スイート 116 files / 1484 passed / 1 skipped、`pnpm lint` / `pnpm check-types` green
（すべてローカルで実測）。GitHub Actions の CI ワークフローも success。

## 出荷時に踏んだ CI の罠（解決済み・2026-07-26）
出荷時点では gate-dod.sh の B1 が恒常 FAIL しており `--skip-dod` でマージした。原因は
`.github/workflows/codex-review.yml`（devflow 同梱テンプレート）が呼ぶ共有ワークフローが
`OPENAI_API_KEY` を **`required: true`** で宣言しており、secret 未設定のこのリポジトリでは
`vars.CODEX_REVIEW_ENABLED` による opt-in 判定より**前**（ジョブ生成前）に startup failure
していたこと。`gh run list` 上は 0 秒・ジョブ 0 件の failure、`gh pr checks` は
"no checks reported" を返すという分かりにくい出方をする。同日ワークフローを削除して解決
（`67197af`）。経緯と再有効化手順の正典は `docs/dev/feature-flow.md`。
→ **教訓: opt-in 前提の再利用ワークフローで `required: true` の secret を宣言すると、
未設定の消費側リポジトリが全 PR で赤くなり出荷ゲートを塞ぐ。**

## 本番配備（2026-07-26 完了）
- `users.id` = popon（本番の admin はこの 1 名のみ）
- `/opt/kagetra/.env.production` に `ROLE_PREVIEW_USER_IDS=<popon の id>` を追記（バックアップ
  `.env.production.bak-20260726-rolepreview` を同ディレクトリに残置。パーミッションは
  600 kagetra:kagetra のまま）
- `sudo systemctl restart kagetra-web.service` → active、稼働プロセスの environ に反映を確認、
  公開 URL は 307→/auth/signin・signin 200、起動後ログにエラーなし
- **ビルド出力で `process.env.ROLE_PREVIEW_USER_IDS` がインライン化されず実行時参照のまま
  であることを確認済み**（Node チャンクと Edge の middleware バンドル双方）。よって値の変更は
  再ビルド不要・再起動のみで反映される。middleware 側にも文字列は載るが、読むのは
  `trigger === 'update'` 分岐だけなので Edge では実行されない
- 無効化は値を空にして再起動するだけでよい（fail-closed）

## 残 DoD
実機（PWA）での AC-14（バッジタップでシート）/ AC-15（PWA 再起動をまたぐ持続）/
AC-17（会員としての書き込み）のみ。ユーザー自身が確認する。
