---
name: ship-entry-overdue-alert
description: entry-overdue-alert 出荷(2026-07-25)
type: project
---

PR #312 出荷完了（merge commit f442d03・2026-07-25）。
https://github.com/poponta2020/kagetra_new/pull/312

## 出荷内容
会内締切を過ぎても未申込の大会を管理者個人 LINE（system_notify Bot）へ毎朝 1 通のサマリで通知する機能と、進行管理の 3 値目 `not_applying`（申込なし）。event-lifecycle-notify に対する delta で、同機能が §7 範囲外としていた「締切超過後の継続催促」「管理者専用の出し分け」を反転した。

- `event_line_broadcasts` へ JOIN しない = **LINE グループ未紐付けの大会も対象**（申込漏れが最も起きやすい層。既存リマインドでは 1 通も飛ばなかった）
- 通知ログ表を構造的に持たない（毎日鳴ることが要件そのもの）
- `not_applying` を 3 値目にしたことで、既存の申込締切リマインド（`entry_status='not_applied'` 条件）から自動的に外れる。この条件を「applied 以外」に緩めてはならない
- migration 0043（ALTER TYPE ADD VALUE のみ・ロールバック不可）
- 新規 systemd timer は JST 07:00（既存 lifecycle-reminders の 00:00 に相乗りしない）

## クローズした Issue
親 #305 / 子 #306-#311（PR 本文の closing keyword によりマージ時に自動クローズ）

## レビュー
Codex 4R（全 high）で pass。累計 777,056 トークン。**3 ラウンド連続で blocker が出たが、すべてデプロイ経路でアプリコードの blocker はゼロだった**:
1. systemd `.timer` の `Requires=` が `enable --now` で service を即時起動（非冪等アラートで重複 push）
2. `infra/sudoers/kagetra-deploy` への新規 unit allowlist 追記漏れ（auto-deploy が最初の install で確実に fail）
3. sudoers 先行配置手順の `git checkout <ref> -- <path>` が index を汚し auto-deploy.sh:25 のクリーン検査で中断
詳細は [[auto-review-round-pr312]] / [[fix-pr312]]。

## 残 DoD（本番作業）
- **AC-21（manual）が未消化**。手順は docs/deploy/entry-overdue-alert.md。**§0 の sudoers 先行配置は auto-deploy が更新しないため必ず手で行う**（未実施だと自動デプロイが失敗する）。以降 §1（git pull → pnpm install → db:migrate の順序厳守）→ §2 build → §3 unit → §4 動作確認。
- 実装記録は [[impl-entry-overdue-alert]]
