---
name: fix-pr582
description: fix PR #582
type: project
---

PR #582（メール処理画面からの振込連絡）の Codex R1 指摘3件を修正した。3件ともユーザー承認済み（見送りなし）。

**blocker 1 — 送信不可時に共通項目まで保存できない**: 要件 §3.3.5.3（セクションが描かれている限り保存する）と実装手順書タスク5（可否判定 ok のときだけ受け付ける）が食い違っており、ユーザー判断で**要件を正**とした。`loadPaymentNoticeContext` の失敗側に `commonFields` を足し（dueDays が空なら非中止の全日から代表値）、`processMail` の可否判定を `send: true` のときだけに移し、UI は不可でも振込期限・振込先の入力欄を出す。

**blocker 2 — 先行配信の400で振込連絡が無記録に脱落**: ★`line-broadcast.ts` の `applyPushFailureRecovery` が「429以外の全4xxで revoke」のまま取り残されていた（`event-lifecycle-notify.ts` は 401/403/404 限定で正しかった）。要件 §6 の契約は PR #530 で片方にしか適用されていなかった。403/404 限定へ修正。あわせて送信時再検証で不可になったときに `recordPaymentNoticeFailure` で試行記録を残すようにした（processMail は既に ok を返しメール一覧へ戻るので、記録しないと誰も気づけない）。

**blocker 3 — 成功→再送失敗で「送信済」と「送信失敗」が同時表示**: `last_error` は成功でクリアされるが `last_sent_at` は残るため、成功→失敗の順序で相反表示になる。失敗優先表示（見出しも「送信失敗」・過去の成功は「最終成功」として別表示）へ。

**テストの罠**: `vi.mock('@/lib/events/payment-notice-send')` を丸ごと差し替えると `recordPaymentNoticeFailure` が消えて検証対象そのものが動かない → `importActual` スプレッドで `sendPaymentNoticeCore` だけスパイ化する。同様に `vi.mock('@/lib/event-grade-broadcast')` も `resolveTargetGrades` を巻き添えにする。

**波及**: 400 revoke の変更で `line-broadcast-helpers.test.ts` と `mail-inbox/open-chat-actions.test.ts` の既存アサーションを更新（400 では revoke されない＝紐付けはそのまま再配信できる）。docs/spec/notifications.md・mail-worker.md も更新。

テスト: 対象10ファイル 145件 + 回帰（line-broadcast / open-chat / mail-inbox actions）341件すべて green。tsc / eslint 通過。
