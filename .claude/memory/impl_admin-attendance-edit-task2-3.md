---
name: impl-admin-attendance-edit-task2-3
description: admin-attendance-edit タスク2・3
type: project
---

admin-attendance-edit タスク2・3 完了（全タスク完了）。

タスク2（UI・#547）:
- apps/web/src/components/events/attendance-edit-section.tsx（新規・client）。参加者一覧（氏名＋級添字＋ゲスト印＋「対象外」マーク〔title で説明〕＋削除ボタン）＋ 検索付き追加候補リスト。useTransition + pendingUserId で行単位の busy 表示、失敗は Server Action の message をそのまま表示
- Server Action は props で受け取る（GradeBroadcastSection と同じ形。jsdom テストで vi.fn() に差し替えられる）
- ローカル state に参加者一覧を持たない（DB と画面の2系統にしない）。反映は revalidatePath 委せ
- events/[id]/edit/page.tsx: Promise.all に loadAttendanceEditData を足し、EventForm の**外**（下）に描画
- ★page-padding.test.ts の TARGET_PAGES に edit/page.tsx が入っている（2スペースの `return (` がちょうど1本）。ヘルパーコンポーネントを同ファイルに足さず、既存 JSX へ要素を1つ足すだけにして回避。テスト15件 green で確認済み
- jsdom テスト7件 green

タスク3（docs・#548）:
- docs/spec/events-attendance.md を4箇所 in-place 更新（出欠登録ルール／対象者・対象級の絞り込み〔eligibleUsersWhere が正典〕／/events/[id]/edit 編集／API（Server Actions））
- docs/features/INDEX.md に行追加（メイン側の未コミット行は「主要領域: 未定」だったので worktree 側で実装後の値を書いた。メイン側の未コミット差分は残っている＝マージ後に重複しないか要確認）

検証: attendance-edit-section.test.tsx 7件・page-padding.test.ts 15件・admin-attendance-actions.test.ts 19件・attendance-edit.test.ts 8件・page.test.tsx 47件 すべて green。eslint（対象ファイル）・tsc --noEmit clean。フルスイートは未実行（CI 委譲）。
commits: af53dd8 / 7626cc4 / 0472993。worktree: C:/tmp/impl-admin-attendance-edit
残: AC-10（本番実機確認）は出荷後。
