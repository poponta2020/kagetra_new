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

## CI の注意（本 PR 固有ではない）
`gh pr checks` は "no checks reported" を返すが、`gh run list` では 2 ワークフローが動く。
**「Devflow Codex review」ワークフローは全ブランチで 0 秒で failure する（未設定・恒常的に
壊れている）**。gate-dod.sh の B1 はこれを「失敗しているチェック」と見なして SHIP 不可に
するため、この状態が続く限り毎回 B1 が FAIL になる。実際の lint/typecheck/test/e2e を
回すのは「CI」ワークフローで、そちらは success。ワークフロー自体の修理か
gate-dod 側の除外設定が別途必要。

## 残 DoD（本番手作業）
1. 対象ユーザーの `users.id` を確認（`SELECT id, name FROM users WHERE name = '...'`）
2. `/opt/kagetra/.env.production` に `ROLE_PREVIEW_USER_IDS=<users.id>` を追記
3. web サービスを再起動（`systemctl restart`。Node 側で `process.env` を読むだけなので再ビルド不要）
4. 実機（PWA）で AC-14（バッジタップでシート）/ AC-15（PWA 再起動をまたぐ持続）/ AC-17（会員としての書き込み）を確認
5. 無効化は値を空にして再起動するだけでよい（fail-closed）
