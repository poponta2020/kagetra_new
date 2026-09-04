---
name: ship-payment-receipt-broadcast
description: 支払報告に証憑（振込明細の写真）のアップロードと LINE 配信を追加
type: project
---

PR #566 マージ完了（2026-09-04）。https://github.com/poponta2020/kagetra_new/pull/566
親 Issue #554 / 子 #555-564 はすべて closing keyword で自動クローズ。

## 出荷した中身
申込グループページの一括操作「支払済にする」→「**支払報告**」へ改称し、振込明細の写真を証憑として最大3枚アップロードして、大会別 LINE グループへ「振込完了＋景虎上の想定金額＋明細画像」を1回の操作で流せるようにした。証憑は記録として残り、失敗時は同じ内容で再送できる。
- migration 0062: entry_group_payment_reports（1回=1行の追記専用・送信本文のスナップショット message_text）+ entry_group_payment_receipts（1枚=1行・正規化後 JPEG と preview を bytea・公開トークン）
- lib/payment-receipt/image.ts（JPEG/PNG 以外を拒否→EXIF回転→4096px→quality段階下げで10MB以内→240px プレビュー）
- lib/events/payment-report-amount.ts（振込連絡 total_jpy > その場集計 > none）+ lib/payment-report-message.ts（証憑0枚は現行と完全同一の文面）
- api/line-broadcast/payment-receipts/[token]（+/preview）認証なし公開 route
- Server Action reportPayment / resendPaymentReport、PaymentReportSheet、進行管理内の履歴＋再送
- next.config.ts の serverActions.bodySizeLimit 4mb→8mb（**全 Server Action に効くグローバル変更**）

## ★この出荷で学んだこと（再発防止）
1. **`'use server'` ファイルは async 関数以外を export できない**。`export const MAX_PAYMENT_RECEIPTS = 3` だけで `pnpm build` が `Only async functions are allowed to be exported in a "use server" file` で止まる。**型の export（interface/type）は消えるので問題ない**。ローカルの check-types・lint・vitest は全部 green のまま通るので、CI かレビューでしか気づけない
2. **`'use server'` から値や共有ロジックを export すると、それ自体が認可ガードの無い公開エンドポイントになる**。共有する中核は素のモジュール（lib/）に置き、requireAdminSession と revalidatePath は各 action ラッパーに残す
3. **delta ラウンドが pass でも final（全差分）で blockers が出る**。この PR は R2 delta pass の後、R3 final で 5件出た。うち「送信先を代表イベントの現在所属から引き直すため証憑が別グループへ流れ得る」は外部への誤送信。**final を省略しない**
4. **LINE の previewImageUrl は 240x240 が公式仕様**。要件定義書の 1024px は誤りだった。lib/line-broadcast.ts に「大判プレビューで配信ごと partial/failed に倒れた」実績コメントがある
5. **LineMessage union に image を足してはいけない**。.text を直接読む既存テストが12箇所で型エラーになる。送信トランスポートが受ける LineOutgoingMessage だけを広げる

## レビュー（auto-review-loop）
4ラウンドで pass（initial 1 + delta 1 + final 1 + final-delta 1）。effort は全ラウンド high。累計 **670,741 トークン（既定上限 500,000 を超過）** —— R3 final で blockers 5件が出たため、その確認（R4・差分655行）を省くと最新結果が needs_changes のままで出荷が機械的に止まる、と判断して実行した。
**再レビューせずに修正した指摘は無い**（R4 が最終形の修正を確認済み）。
WONTFIX 1件（ユーザー判断）: プレビュー金額と実送信額の乖離（page.tsx）。発生窓が短く、送った文面は message_text に正しく残るため。

## 残 DoD
- **AC-25（本番実機確認・未実施）**: 本番で iPhone 撮影の振込明細を実際に上げ、大会 LINE グループに文言と画像が届くこと。消化手順=本番デプロイ後に `/admin/entries/[groupId]` で事前払い・未払の日を選び「支払報告」→写真1枚を添えて実行→LINE グループで文言と画像を確認
- CI（Lint/Typecheck/Test）は **pending のままマージ**した（v0.9.0 の方針）。赤くなったら /quickfix で追修正する
