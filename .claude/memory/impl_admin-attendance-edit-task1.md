---
name: impl-admin-attendance-edit-task1
description: admin-attendance-edit タスク1
type: project
---

admin-attendance-edit タスク1（Server Actions + 共通化 + ローダー）完了。

実装:
- apps/web/src/lib/events/eligible-users.ts（新規）: eligibleUsersWhere(eligibleGrades) — isInvited=true ∩ 対象級 の where を1本化。★級未設定の除外は SQL の IN vs NULL の意味論に依存しているので TS 側で書き直さない（advisor 指摘）。3箇所で共有: /events/[id] の分母・adminAddAttendee の検証・編集画面の候補
- apps/web/src/lib/events/attendance-edit.ts（新規）: loadAttendanceEditData(eventId, eligibleGrades) → { attendees(outOfScope フラグ付き), candidates }。列は id/name/grade/role のみ（RSC payload に PII を載せない）
- events/[id]/actions.ts: adminAddAttendee / adminRemoveAttendee + revalidateAfterAttendanceChange（/events/[id]・/edit・/events・/events-archive・/admin/entries・/admin/entries/[groupId]・/dashboard）
- events/[id]/page.tsx: eligibleUsers の where をヘルパーへ差し替え（挙動不変。and/inArray が未使用になるので import からも削除）

設計の要点:
- 追加は候補条件を SQL の WHERE に載せて users を引き直す fail-closed 検証（TS で級を突き合わせ直さない）
- 削除は候補条件を**検証しない**。対象級外の stale な attend=true 行を消せるようにするのがこの画面の役目（検証すると永久に消せなくなる）
- upsert の set に comment を含めない＝既存コメント保持（submitAttendance と同じ規約）

テスト: 27件 green（admin-attendance-actions.test.ts 19 / attendance-edit.test.ts 8）＋ page.test.tsx 47件 回帰 green。eslint・tsc --noEmit clean。
worktree: C:/tmp/impl-admin-attendance-edit（commit af53dd8）
環境メモ: worktree は corepack pnpm install と .env / apps/web/.env.local のコピーが必要（実施済み）。
★events/[id]/edit/page.tsx は page-padding.test.ts の TARGET_PAGES に入っている（2スペースインデントの `return (` がファイル内でちょうど1本という機械ガード）。タスク2 でヘルパーコンポーネントを同ファイルに足さないこと。
