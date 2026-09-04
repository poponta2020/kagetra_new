---
name: impl-payment-receipt-broadcast
description: payment-receipt-broadcast 実装（全10タスク）
type: project
---

payment-receipt-broadcast（親 Issue #554 / 子 #555-564）を全10タスク実装し feature/payment-receipt-broadcast へ push（PR 未作成の段階で記録）。worktree=C:/tmp/impl-payment-receipt-broadcast。

## 実装した中身
- migration 0062 で entry_group_payment_reports（支払報告1回=1行・追記専用・送信本文のスナップショット message_text を持つ）と entry_group_payment_receipts（証憑1枚=1行・正規化後 JPEG と preview を bytea・公開トークン）を新設
- lib/payment-receipt/image.ts（sharp で JPEG/PNG 以外を拒否→EXIF回転→4096px→quality段階下げで10MB以内→preview生成）
- lib/events/payment-report-amount.ts（振込連絡 total_jpy > その場集計 > none）+ lib/payment-report-message.ts（証憑0枚は buildLifecycleMessage('payment_paid') をそのまま返す）
- api/line-broadcast/payment-receipts/[token]（+/preview）の公開 route
- Server Action reportPayment / resendPaymentReport（admin/entries/[groupId]/actions.ts）
- PaymentReportSheet（ボトムシート）・PaymentReportHistory（進行管理内の履歴＋再送）
- next.config.ts の serverActions.bodySizeLimit 4mb→8mb

## ★計画から変えた設計判断（Advisor 指摘 + 実装中の実測）
1. **applyPaymentsPaid の置き場**: 計画は events/[id]/actions.ts 内での抽出だったが、あのファイルは 'use server' なので export した瞬間に**認可ガードの無い公開エンドポイント**になる。素のモジュール lib/events/apply-payments-paid.ts へ置き、requireAdminSession と revalidatePath は各 action ラッパーに残した
2. **LineMessage union を広げてはいけない**: lib/line-mention.ts の LineMessage に image を足したら、.text を直接読む既存テスト（line-webhook-handler.test.ts・payment-notice.test.ts）が 12 箇所で型エラー。**LineOutgoingMessage = LineMessage | LineImageMessage** を新設し、広げるのは push トランスポートの引数型だけにした
3. **status は pgEnum**: 計画は「entry_form_drafts に倣って text + $type」と書いていたが、実際の entry_form_drafts.status は pgEnum。text+$type の前例はスキーマ全体で auth.ts の1件だけ。pgEnum で揃えた
4. **packages/shared に DB テスト基盤は無い**（vitest.config.ts は environment:'node' の純関数スモーク専用）。CASCADE テストは apps/web 側に置いた
5. **タスク5 は Wave から外して main 直**: 完了条件が「既存テストを1行も変えずに green」で、worker_verify:none のワーカーはテストを実行できず唯一の証拠が取れないため

## AC-12 の検証方法（値の比較では検出できない）
tallyEntryFeesForGroup は支払済の日を除外しないので、金額算出を flip の後ろへ動かしても値が変わらない。resolvePaymentReportAmount を vi.mock で薄く包み、**呼ばれた瞬間の payment_status を記録**して 'unpaid' だったことを assert する形にした。

## テスト結果
関連15ファイル157本 green（vitest --no-file-parallelism）。pnpm --filter=@kagetra/web check-types も green。
残 DoD: AC-25（本番で iPhone 撮影の振込明細を実際に上げて LINE へ届くか）は未確認。

## レビュー（advisor）で見つかった3件と修正（commit 51b53b5）
1. **fail-closed の穴（実害あり）**: reportPayment が `applyPaymentsPaid` を呼んで**別グループの日を flip してから** entryGroupId を突き合わせていた。applyPaymentsPaid は ids[0] からグループを自分で解決するので、groupId=A ＋ B の日で呼ぶと B の日が支払済になり、さらに `payment_paid` の once-ever スロットが claim されて finalize されないまま残る → **UNIQUE(event_id,type) で B の完了通知が永久に送れなくなる**。突き合わせを画像正規化より前へ移し、applyPaymentsPaid にも `expectedEntryGroupId` ガードを追加。★テストが「エラー文字列だけ」を見ていて検出できていなかった（他グループの状態まで assert すること）
2. **プレビュー 1024px → 240px**: LINE の previewImageUrl は 240x240 が公式仕様。`lib/line-broadcast.ts` に「大判プレビューで配信ごと partial/failed に倒れた」実績コメントがある。要件定義書の 1024px はその実績を読む前に書かれたもの
3. **skipped_unlinked の取り違え**: 「紐付けはあるが送るものが無かった」（証憑0枚 ∧ claim できる日なし＝AC-14 の正常経路）も skipped_unlinked にしていて、画面に「LINE 未連携」と出て DB にも嘘が残っていた。enum に `skipped_no_change` を追加して分離（migration 0062 は未マージだったので作り直した）

