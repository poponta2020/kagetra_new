---
name: feature-def-payment-receipt-broadcast
description: payment-receipt-broadcast 要件定義(2026-09-04)
type: project
---

payment-receipt-broadcast 要件定義（2026-09-04）

申込グループページの一括操作「支払済にする」を「**支払報告**」へ改称し、支払明細（振込明細の写真）を最大3枚アップロードして大会別 LINE グループへ「振込完了＋景虎上の想定金額＋確認依頼＋明細画像」を1操作で送れるようにする改修。親 #554 / 子 #555-564（全10タスク・Wave 7段）。正典= docs/features/payment-receipt-broadcast/。

★**依頼は「申込済みにするボタン」だったが、運用ヒアリングで対象は「支払済にする」だと判明**。この会の振込は名簿確定後（@会計 への振込連絡を受けてから）で、申込時点は抽選前のため振込額が確定しない（entry_applied_treasurer の文面が『振込連絡は名簿確定時に連絡します。』と予告しているのはこのため）。ユーザーの言葉どおりに実装していたら振込前の証憑を要求する画面になっていた。

主な設計判断:
- 証憑は**任意**（0枚なら現行と完全同一の挙動）。必須にすると明細が手元に無い状態で支払報告できず既存フローが止まる
- 想定金額は **entry_group_payment_notices.total_jpy（振込連絡で送った額）を優先**、未送信ならその場で tallyEntryFeesForGroup、出せなければ金額行ごと省く。「振り込んでと伝えた額」と「一致確認してほしい額」をズラさないため
- 級未設定の未算入注記は **tally 由来のときだけ**付ける（振込連絡の額は管理者が人数を確認した確定値）
- ★**証憑が1枚以上あるときは payment_paid の once-ever claim に依らず必ず送信する**。once-ever は『同じ完了通知を2度流さない』ための仕組みで、証憑の配達を止めるものではない。未払に戻して再度支払報告すると証憑が届かなくなる事故を避ける
- ★**HEIC は非対応**（実測: sharp 0.34 / libvips 8.17.3 の heif 入力は fileSuffix が .avif のみ＝HEVC デコード不可）。当初 JPEG/PNG/HEIC で合意していたが実測で覆り、ユーザー判断で JPEG/PNG へ後退。iOS はカメラロール選択なら既定で JPEG 変換して渡すので実害小
- ★**公開取得 route は api/line-broadcast/ 配下に置く**。middleware.ts の公開判定は config.matcher の否定先読みで、api/line-broadcast が既に列挙済み＝matcher を編集せず認証を素通りできる（LINE の画像フェッチャは Cookie を送らないので除外し損ねると全画像がログイン画面へ 302 し、メッセージだけ黙って壊れる）
- image-cache.ts は使わない（プロセス内メモリ・非永続）。証憑は bytea の新テーブル2本（reports 親 / receipts 子）へ永続保存し、公開 route は DB から直接引く
- setPaymentsPaid は applyPaymentsPaid へ**挙動差分ゼロの純粋抽出**。既存テストを1行も書き換えずに green であることが唯一の回帰の証明
- serverActions.bodySizeLimit を 4mb→8mb（全 Server Action に効くグローバル変更）。クライアント側で長辺2048px・JPEG q0.85 へ縮小してから base64 で送る
- ★AC-12（金額は flip 前に確定）のテストは**値の不変ではなく順序を assert する**。tallyEntryFeesForGroup は支払済の日を除外しないため、順序を入れ替えても値が動かず値比較では退行を検出できない

AC 25件（auto-test 24 / manual 1）。**design-screen はユーザー判断でスキップ**（『いい感じにしといて』）— 見た目の指針は requirements §8 に既存プリミティブ踏襲として明文化済み。実装未着手。
