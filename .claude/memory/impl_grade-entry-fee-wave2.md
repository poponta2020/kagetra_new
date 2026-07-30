---
name: impl-grade-entry-fee-wave2
description: grade-entry-fee 改修 Wave2（総額集計・通知文面）
type: project
---

grade-entry-fee 改修の Wave 2（タスク3・4 を task-implementer 2並行）。worktree = C:/tmp/impl-grade-entry-fee。

**タスク3**（#426・commit 9922901）: `apps/web/src/lib/entry-fee-tally.ts` — `tallyEntryFees(dbc, eventIds)` / `tallyEntryFeesForGroup(dbc, entryGroupId)`。
- **最大の落とし穴＝母集団の非対称性**（advisor が事前指摘）: `page.tsx` の `eligibleAttendingList` は `eligible_grades` 非空なら `inArray(users.grade, ...)` で **grade IS NULL を自然に落とす**、NULL/空配列なら `isInvited` だけ。つまり「級未設定 N名は未算入」の注記が出るのは **eligible_grades が NULL/空のときだけ**。`resolveTargetGrades`（NULL/空→全級A〜E）を母集団フィルタに流用すると AC-9 と AC-10 が同時に壊れる。**resolveTargetGrades は pricing 専用**
- 「空配列は early-return」は `ANY(ARRAY[])` を発行しない意味であって「集計をスキップ」ではない
- main が追加: `tallyEntryFeesForGroup` から `status='cancelled'` の日を除外（中止日に振込む額は無い。リマインドの候補抽出も cancelled 除外なので母集団を揃えた）

**タスク4**（#427・commit 1f75bb3）: `buildLifecycleMessage` に任意フィールド4つ（`unitPricesLabel` / `totalJpy` / `breakdownLabel` / `unknownGradeCount`）を追加。未指定なら現行分岐に落ちるのでバイト互換が自明。既存アサーションの変更は `payment_paid` の2件だけ（要件で承認済み）。

**モジュール依存の向き（重要）**: `entry-fee.ts` → `event-lifecycle-notify.ts`（`formatFeeAmount` を import）の一方向。逆向きに張ると循環するため、`※級未設定 N名は未算入` の整形は **notify 側に `formatUnknownGradeNote` として1本化**した（ワーカーが両側に複製したのを main が統合）。クライアントコンポーネントは notify を import できない（drizzle が client バンドルへ入る）ので、整形済み文字列を props で渡す。
