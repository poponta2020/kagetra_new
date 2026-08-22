---
name: impl-line-bot-message-revamp
description: line-bot-message-revamp 実装
type: project
---

大会別LINE Botのメッセージ全面改訂（親Issue #519 / 子 #520-527）を worktree `C:/tmp/impl-line-bot-message-revamp`（ブランチ feature/line-bot-message-revamp）で実装。

## Wave 構成（実績）
- **Wave 1（2ワーカー並行）**: タスク1 #520 メンション基盤（新規 line-mention.ts）／タスク5 #524 ライフサイクル通知8種の文面差し替え。変更領域が完全に分離していて衝突ゼロ
- **main 直列**: タスク2 #521（schema + migration 0059）→ トランスポート拡張 → タスク3 #522 → タスク7 #526（migration 0060 + payment-notice.ts）→ タスク8 #527（UI + Server Action）
- **Wave 3（2ワーカー並行）**: タスク4 #523 webhook ①〜④／タスク6 #525 E-2 予告文

計画では Wave 1 にタスク2（migration あり）を入れていたが、profile 規約で migration は main 担当かつ「main 直タスクはワーカーと同時に走らせない」ため、**Wave 1 からタスク2 を外して main の直列ブロックへ移した**。タスク3 は単一の小モジュールなので委譲せず main が実装（起動コストの方が高い）。

## 計画になかった必須の波及（deep-advisor 相談で事前に検出）
**トランスポートの契約変更が3タスク（#523/#525/#527）に跨る。** 計画はタスク4のメモに `LineReplyClient` の拡張だけ書いていたが、実際は push 側（`pushTextToEventGroup` が `messages: [{type:'text',text}]` をハードコード）も同じ拡張が要る。3ワーカーが各自で広げると同じファイルで契約が食い違うので、**タスク1 が `LineMessage` 型を持ち、main が Wave 1 バリア後に両トランスポートへ通してから Wave 3 を起動**する順序にした。

- reply: `reply({ replyToken, messages: readonly LineMessage[], channelAccessToken })`
- push: `pushMessagesToEventGroup` / `pushTextToEventGroup`（薄いラッパー）/ `pushMessagesToEntryGroup`（グループ単位・振込連絡用）+ `loadLinkedBindingForGroup`
- `sendClaimedNotification(Bulk)` / `sendReminderNotification` は `message: string | readonly LineMessage[]`

## その他の発見
- `tallyEntryFees` は `GradeHeadcount[]` を内部で作って `summarizeFeeTally` に捨てていた。振込連絡の級別人数の初期値がまさにこれなので `FeeTallyResult.headcounts` を**追加**（既存フィールドは不変＝バイト固定テストが動かない）
- `z.record(z.enum([...]), v)` は zod v4 で**全キーの存在を要求**する。人数0の級はキーごと落ちるので `z.record(z.string(), v)` + 手動フィルタに変更（テストで発覚）
- `noUncheckedIndexedAccess: true` なので `values[i++]` は `T | undefined`。ワーカーの生成コードで2箇所踏んだ
- ③の申込人数（実人数・ゲスト込み）と参加費集計（延べ・ゲスト除外）は**意図的に別母集団**。`entry-headcount.ts` を新設して `entry-fee-tally.ts` を流用させない
