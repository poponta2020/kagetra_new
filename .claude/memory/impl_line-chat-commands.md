---
name: impl-line-chat-commands
description: line-chat-commands 実装（全4タスク）
type: project
---

line-chat-commands（親 #606 / 子 #607-610）を全4タスク実装。worktree = `C:/tmp/impl-line-chat-commands`、ブランチ `feature/line-chat-commands`（push 済み・PR 未作成）。

## Wave 構成と委譲

- **Wave 1 = タスク1・3 を task-implementer へ並行委譲、タスク2 は main 直実装**。実装手順書は Wave 1 に3つ全部を並べていたが、タスク2 は「意図的なエラー処理の非対称を揃えない」という指示が中核で、Sonnet ワーカーが"整理"して壊す典型形だったため main が引き取った。結果、Wave の共有ファイル問題もゼロになった
- Wave 2 = タスク4（main）。受け入れ確認で排他宣言ミスは無し
- ワーカーの成果はどちらもそのまま採用（authz は `userId` を member/guest でも返す設計にしていたが、認可は entry/payment の boolean だけを見るので影響なし）

## ★実装中に見つけた要件の穴（要件定義書を訂正した）

**要件 §3.2.2 の語リストが、要件自身が挙げる AC-9 の例を通さない。** 例「申し込んで振り込みました」は列挙語（申込 / 申し込み / 申込完了 / 申込済 / 申し込みました / 申し込んだ）のどれにも一致しない（`申し込んで` は `申し込み` でも `申し込んだ` でもない）。ワーカーが書いた AC-9 のテストが実際に落ちて発覚。**連用形の語幹 `申し込ん` / `振り込ん` を追加**して解決し、requirements.md にも追記した。否定形は §3.2.4 の否定判定が先に弾くので安全側は保たれる。

## ★実装手順書の処理順が AC に反していた（訂正した）

手順書のタスク4 は「③メンション → ④語 → ⑤否定なら返信して終了 → ⑥broadcast 検証 → ⑦認可」。この順だと**一般会員の「@Bot まだ申し込んでません」や、紐付いていないグループの発言にまで「判定できなかった」と返信してしまい**、AC-3 / AC-4 / AC-12 の「返信もされない」に反する。→ **認可を否定判定より前へ移し、認可されたアクションが0件なら無言で終了**する順に変更。認可は**アクションごと**に絞る（副管理者の「申し込んで振り込みました」は支払だけ実行し、申込については何も返さない）。implementation-plan.md に訂正内容を書き込み済み。

## ★返信分岐には実行前スナップショットが必須

`applyEntriesApplied` / `applyPaymentsPaid` の戻り値だけでは **「すでに完了」（AC-7）と「進められる日が無い」（全日 not_applying / 事前払いゼロ）が区別できない** — どちらも flip 0件になる。実行前に各日の `id / eventDate / status / entryStatus / paymentType / paymentStatus` を控え、**スナップショット × flip 結果**で返信を決める。AC-6 の「対象外の日」ラベルにも eventDate が要る。

## その他の設計判断

- Bot の userId は `payload.destination` をそのまま使う（`loadChannelByDestination` が `webhook_destination_id` と突合している値そのもの）。チャネルの再ルックアップ・型の拡張は不要
- **`revalidatePath` は webhook 経路に入れない。** `/admin/entries` と `/admin/entries/[groupId]` は `force-dynamic` なので不要で、lib に `next/cache` を持ち込むとテストがモック必須になる。※`/events/[id]` 詳細のキャッシュだけは未確認
- 語判定は**メンション文字列を全 range 除去してから**行う（Bot 表示名が語を含むとメンションだけで発火する）。除去は index 降順（前から消すと後続 index がずれる）
- 招待コード分岐は触らない。`^\d{6}$` を生の trim 済みテキストで見ているので `@Bot 123456` はコードにならず、こちらの経路も語に一致しない
- `parseChatCommand` へ渡す text は **trim しない生本文**（mentionee の index は生本文のオフセット）

## 変更ファイル

新規: `lib/line-chat-command.ts`(+test) / `lib/line-chat-authz.ts`(+test) / `lib/line-chat-command-reply.ts` / `lib/events/apply-entries-applied.ts`
変更: `lib/line-webhook-handler.ts`(+test 22件追加) / `app/(app)/events/[id]/actions.ts` / `lib/events/apply-payments-paid.ts`（`buildPaymentPaidMessage` + `notifyPaymentsPaid` を移設・追加） / `docs/spec/notifications.md` / 要件・手順書

## 検証結果

- `line-chat-command.test.ts` 28件 / `line-chat-authz.test.ts` 9件 / `line-webhook-handler.test.ts` 66件（既存44 + 新規22）すべて green
- **タスク2 の回帰ハーネス**（`event-lifecycle-notify.test.ts` / `lifecycle-actions.test.ts`）は**1行も変えずに green** ＝ 申込 flip の移設が挙動不変であることの証明
- `tsc --noEmit`（web）・eslint（変更ファイル）green。フルスイート・E2E は未実行（CI に委譲）
- AC-15（本番実機）は manual・未実施
