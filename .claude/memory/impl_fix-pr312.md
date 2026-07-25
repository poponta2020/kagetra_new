---
name: fix-pr312
description: fix PR #312
type: project
---

PR #312 (feature/entry-overdue-alert) の Codex レビュー R1 指摘を修正。

## 対応した指摘
- **[CRITICAL] systemd .timer の Requires= が service を即時起動する**（apps/web/systemd/kagetra-entry-overdue-alert.timer）
  Requires= は activation 依存なので、systemctl enable --now でタイマーを起動すると依存先 service も同時に起動される。07:00 を待たずに実 LINE 通知が飛ぶ。既存の kagetra-lifecycle-reminders.timer も同じ書き方だが、あちらは once-ever UNIQUE で再実行が no-op になるため実害が出ず露見していなかった。**非冪等なバッチにこのパターンを流用すると重複 push になる**。Unit= だけで発火時の起動には足りるので Requires= を削除し、既存ユニットと違う理由をコメントで明記した
- **[WARNING] PUBLIC_BASE_URL の形式未検証**（apps/web/src/lib/entry-overdue-alert.ts）
  空文字だけ弾いていたので、裸のホスト（new.hokudaicarta.com）や http:// でも送信されてしまい、LINE 上でタップできない文字列が届くだけになる。line-broadcast.ts の resolveBaseUrl と同方針の https:// 検証を追加（import はせず各モジュールで明示する既存方針を踏襲）。it.each で 3 種の不正値テストを追加
- **[WARNING] requirements.md 内の矛盾**（§3.2.2「確認ダイアログも不要」vs §8「常に window.confirm」）
  実装とテストは §8 の確定仕様に従っていた。§3.2.2 を確定仕様へ合わせて書き換えた

## 対応しなかった指摘
なし（nits 0 件）

## テスト
entry-overdue-alert.test.ts 30 passed / send-entry-overdue-alert.test.ts 5 passed / check-types green / lint 0

commit ac60c50 / worktree C:/tmp/impl-entry-overdue-alert
