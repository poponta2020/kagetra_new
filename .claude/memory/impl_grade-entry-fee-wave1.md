---
name: impl-grade-entry-fee-wave1
description: grade-entry-fee 改修 Wave1（純関数・payment_type既定値）
type: project
---

grade-entry-fee 改修（表示・通知への配線）の Wave 1。worktree = C:/tmp/impl-grade-entry-fee（branch feature/grade-entry-fee）。

**worktree の初期状態が罠だった**: 同名ブランチが第1回 PR #392 の残骸としてリモートに残っており、ensure-worktree.sh がそれを再利用して **main の80コミット前**から始まった。unique commit 0・main の祖先だったので `git merge --ff-only origin/main` で最新へ揃えた。同じ slug で2回目の改修を回すときは毎回これを確認する。

**タスク1**（#424・commit 848491a）: `apps/web/src/lib/entry-fee.ts` + test（26件）。
- `resolveEntryFee` / `entryFeeForGrade` / `memberEntryFeeJpy` / `summarizeFeeTally` / `formatUnitPricesLabel` / `formatUnknownGradeNote`
- 対象級の決定は既存 `resolveTargetGrades`（event-grade-broadcast.ts）へ委譲し二重定義しない。金額整形は `formatFeeAmount`（event-lifecycle-notify.ts）を import。**依存は一方向**（entry-fee → notify）で、逆向きに張ると循環する
- `perPersonPriced = official && kind==='individual'` が「人数×単価で価格付けしてよいか」の唯一の判定

**タスク2**（#425・commit 324037c）: `events.payment_type` の既定値 NULL→'advance' と backfill（migration 0052_tiny_red_hulk）。
- **drizzle db:generate は ALTER DEFAULT しか吐かない**。backfill の UPDATE は手で `--> statement-breakpoint` の後ろに足した
- **テスト DB は `drizzle-kit push --force` で作られ migration 本文を実行しない**（しかも push 後は DEFAULT が効くので NULL 行が生まれない）。backfill の挙動確認は `apps/web/src/lib/payment-type-backfill.test.ts` で migration ファイルから UPDATE 文を読み出して自分で実行する形にした。列変更 migration の backfill をテストするときの定石
- **既定値変更の波及**: `createEvent` seed が paymentType 省略で 'advance' になり、`send-lifecycle-reminders.test.ts` の「未設定は除外」ケースが落ちた。`paymentType: null` を明示して修正（意図は不変）
