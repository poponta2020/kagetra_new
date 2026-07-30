---
name: impl-grade-entry-fee-wave3
description: grade-entry-fee 改修 Wave3（リマインド配線・支払完了・画面表示）
type: project
---

grade-entry-fee 改修の Wave 3（タスク5・6・7 を task-implementer 3並行）＋出荷前整備。worktree = C:/tmp/impl-grade-entry-fee・branch feature/grade-entry-fee（push 済み）。

**タスク5**（#428・commit 431fcb2）: `send-lifecycle-reminders.ts`。`queryLinkedEvents` に official/kind/eligibleGrades を追加。支払締切は `tallyEntryFeesForGroup` をグループ単位で1回だけ引く（関数ローカル Map でメモ）。現地払いは `resolveEntryFee(...).singleUnitJpy` / `.unitPricesLabel` へ移した（#411 で fee_jpy の供給が止まっても金額が消えないようにする本命の変更）。
- **総額はグループ全日でバケットメンバーの合計ではない**（バケットに入らない日・claim できなかった日も含む）。`buildBucketMessage` は `bucket.members[0]` の値をそのまま使う。ワーカーは合計しがちなのでプロンプトで明示した
- 総額行の書式が単一日（notify）と複数日（script）で複製されたので、main が `buildTotalSuffix` を export して1本化

**タスク6**（#429・commit 66d6a88）: `setPaymentsPaid` の完了通知を総額へ。集計は **tx の外**（flip 後）で claim できたイベントだけを対象に。`PaymentPaidFlipRow.feeJpy` は参照ゼロを確認して削除。

**タスク7**（#430・commit f2a6acd）: page.tsx で導出 → `EventLifecycleSection` へ解決済み値を渡す。総額は `isAdmin` のときだけ引く。注記は整形済み文字列を props（`unknownGradeNote`）で渡す — **client component は event-lifecycle-notify を import できない**（drizzle が client バンドルに入る）。

**予期しなかった既存テストの衝突**（要件 §破壊的変更に無い3件目）: page.test.tsx の「一般会員から隠す情報 (AC-10)」が secrets に `'参加費'` を含んでおり、AC-21 の「あなたの参加費」表示と衝突して落ちた。隠すべきは**進行管理の中身**（格納値・支払方法・振込先・申込方法・振込総額）で会員自身の額はむしろ見せる仕様に変わったため、`'参加費'` → `'振込総額'` に置換し、逆に「あなたの参加費」と導出額が出ることを positive assertion で固定した。**UI の可視性を変える改修では、既存の「見えないこと」テストが仕様変更の検出器になる**。

**出荷前に advisor 指摘で直した設計の穴**（commit 39cc000）: `payment_paid` の総額を「claim できた1日」ではなく**申込グループの全日**に変更。3日グループの1日目だけを支払済にすると `参加費（総額 3,000円）` が飛び、同じグループの支払締切リマインドが既に伝えた `振込総額 11,000円` と食い違う——**どちらも once-ever で訂正できない**。要件 §3.2.2 の「会計はグループ単位で一括請求される」は総額全般の規則なので payment_paid にも及ぶ、と解釈を確定して requirements.md に追記した。once-ever 通知どうしの数字の整合は、単体では正しく見える実装でも壊れる。

**ローカル dev DB（kagetra-db・5433）はスキーマが大幅に古い**（`event_line_broadcasts` テーブル自体が無い・`events.entry_group_id` / `payment_type` も無い）。スクリプトの `--dry-run` はここでは通らないので、テスト DB（5434・worktree 派生名）を `.env.local` に一時差し替えて検証した（検証後に戻す）。

最終検証: web 2441 tests / shared 50 tests / mail-worker 456 tests / lint / check-types すべて green。`--dry-run` はテスト DB に対して例外なく完走（0 candidates）。
