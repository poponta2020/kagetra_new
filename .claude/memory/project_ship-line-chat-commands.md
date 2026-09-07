---
name: ship-line-chat-commands
description: LINE グループの Bot メンションで申込・支払ステータスを進める
type: project
---

**PR #611** — feat(line-chat-commands): LINE グループの Bot メンションで申込・支払ステータスを進める
https://github.com/poponta2020/kagetra_new/pull/611 — **merged**（2026-09-07）。親 #606・子 #607-610 すべてクローズ。

大会別 LINE グループで Bot をメンションして「申し込みました」「振り込みました」と送ると、申込グループ内の `cancelled` でない全開催日の申込/支払ステータスが進む。スキーマ変更・マイグレーションなし。詳細な実装記録は [[impl-line-chat-commands]]、レビュー記録は [[auto-review-round-pr611]]。

## 出荷したもの

- `lib/line-chat-command.ts` — 意図解釈の純関数（メンション判定・語・否定）。**語判定はメンション range を全除去してから**（Bot 表示名が語を含むと誤発火する）
- `lib/line-chat-authz.ts` — `source.userId → users.line_user_id → role` の fail-closed 認可。申込=admin のみ／支払=admin・vice_admin。`is_treasurer` は columns に含めない
- `lib/line-chat-command-reply.ts` — 返信文面（成功時の文面は**存在しない**）
- `lib/events/apply-entries-applied.ts` — 申込 flip の lib 切り出し（**挙動不変**）。`apply-payments-paid.ts` には `buildPaymentPaidMessage` / `notifyPaymentsPaid` を追加
- `lib/line-webhook-handler.ts` — 招待コード分岐の後ろへ配線

## ★出荷時点の残タスク・未確認

1. **AC-15（manual・本番実機）**: 本番の大会グループで管理者がメンション＋「申し込みました」を送り、進行管理画面が申込済みになり完了通知が届くことを確認する。**実行すると once-ever 通知枠を消費する**ので、検証は使い捨ての大会か、実際に申し込む大会で兼ねること
2. **未確認**: `/events/[id]` 詳細画面のキャッシュ。webhook 経路に `revalidatePath` を入れていない（`/admin/entries` 系は `force-dynamic` なので進行管理画面は影響なし）。詳細画面に古い状態が残るようなら追修正
3. **CI は pending のままマージした**（v0.9.0 方針）。赤になったら `/quickfix` で追修正

## ★ユーザー判断で見送った Codex blocker（WONTFIX・将来の再検討用）

`handleChatCommand` は ①broadcast 行を読んで `status='linked'` と発言元グループ一致を検証 → ②**別トランザクション**で flip + once-ever claim、の2段。①②の間に `revokeBroadcast` や Bot の leave が入ると、紐付けが切れたグループからの発言で状態が進み、通知枠だけ消費されて `no_linked_binding`→`skipped` 確定＝**その大会の完了通知が UNIQUE により永久に送れない**。解除直後に別グループへ再紐付けされていれば通知が別グループへ飛びうる。

見送り理由: 発言と紐付け解除がミリ秒単位で重なる必要があり実質観測されない。かつ「紐付けが切れた状態で flip すると once-ever 枠が恒久消費される」挙動は**画面経路（`setEntriesApplied`）に元からある既存挙動**で、この PR の新規ではない。

実害化したときの修正方針: `applyEntriesAppliedInTx` / `applyPaymentsPaidInTx` の既存 seam を使い、flip と同じ tx 内で broadcast 行を `FOR UPDATE` ロックして再検証する（申込側は通知送信を `notifyEntriesApplied` として切り出す必要あり。実質30〜50行）。

## レビュー

`/auto-review-loop` 1ラウンド（initial のみ）/ gpt-5.6-sol / effort=high（認可パスによる高リスク判定）/ 212,408 トークン。verdict=needs_changes（blocker 1件）→ ユーザー見送りにより `cutoff`(user-wontfix) で終了。**修正コミットは1つも無い**ので、再レビューしていない修正差分は存在しない。

## 検証

`line-chat-command.test.ts` 28件 / `line-chat-authz.test.ts` 9件 / `line-webhook-handler.test.ts` 66件（既存44＋新規22）green。タスク2の回帰ハーネス（`event-lifecycle-notify.test.ts` / `lifecycle-actions.test.ts`）は**1行も変えずに** green。`tsc --noEmit`(web)・eslint green。
