---
status: draft
---
# admin-member-create 実装手順書

要件定義書: `docs/features/admin-member-create/requirements.md`

各タスクはテストファースト（テスト作成 → 実装 → green 確認）で進める。

## 実装タスク

### タスク1: createMember Server Action（テスト→実装）
- [x] 完了
- **概要:** 新規会員行を作成する Server Action。UNIQUE violation 判定ヘルパーを self-identify から共通化して流用する。
- **変更対象ファイル:**
  - `apps/web/src/lib/db-errors.ts` — 新規。`isUniqueViolation`（code 23505 + cause 掘り）を共通ユーティリティ化
  - `apps/web/src/app/self-identify/actions.ts` — ローカル定義を削除し `@/lib/db-errors` の import に差し替え（挙動変更なし、既存テスト green 維持）
  - `apps/web/src/app/(app)/admin/members/actions.ts` — 新規。`createMember(prevState, formData)`: admin/vice_admin チェック → zod 検証（name: trim 後 1〜50 文字必須 / grade: A〜E enum or null）→ INSERT（role='member', isInvited=true, invitedAt=now, lineUserId=null）→ 23505 は「同名の会員が既に存在します（退会済み会員を含む）」エラー state → 成功時 revalidatePath('/admin/members')
  - `apps/web/src/app/(app)/admin/members/actions.test.ts` — 新規。正常系（名前のみ/名前+級/trim）、空名前・51文字・不正級の拒否、名前重複エラー、権限（member・未認証は拒否、vice_admin は許可）、作成行のフィールド検証（isInvited/invitedAt/role/lineUserId）
- **依存タスク:** なし
- **対応Issue:** #141

### タスク2: 新規会員追加フォーム UI
- [x] 完了
- **概要:** /admin/members 一覧上部に「新規会員追加」ボタン＋折りたたみインラインフォームを設置。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/members/new-member-form.tsx` — 新規 client component。useState で開閉、useActionState で createMember を呼びエラー/成功表示、成功時にフォームリセット。名前 input + 級 select（未設定/A〜E）+ 登録ボタン
  - `apps/web/src/app/(app)/admin/members/new-member-form.test.tsx` — 新規 jsdom コンポーネントテスト（開閉動作、エラー表示、入力項目の存在）
  - `apps/web/src/app/(app)/admin/members/page.tsx` — 一覧テーブルの上に NewMemberForm を設置
- **依存タスク:** タスク1
- **対応Issue:** #142

### タスク3: updateMemberName + 名前編集の条件付き解禁
- [x] 完了
- **概要:** LINE 未紐付け会員に限り編集ページで名前を修正できるようにする（誤登録リカバリ①）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` — `updateMemberName(prevState, formData)` 追記: admin/vice_admin チェック → zod 検証（タスク1と同じ name ルール）→ `UPDATE ... SET name WHERE id = ? AND line_user_id IS NULL`（単文 race-safe）→ 0行は「LINE 紐付け済みのため変更できません」エラー、23505 は重複エラー → revalidatePath（一覧+編集ページ）
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.test.ts` — テスト追記: 未紐付けで成功、紐付け済みで拒否（DB 不変確認）、重複エラー、権限、バリデーション
  - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx` — `lineLinked`（lineUserId != null）をフォームへ受け渡し
  - `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.tsx` — 未紐付け時: 名前の編集可能な独立小フォーム（プロフィール保存フォームと分離して誤爆防止）+ 注記「LINE 紐付け前のため修正できます」/ 紐付け済み時: 現行 readOnly + 現行注記を維持
  - `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.test.tsx` — 新規: lineLinked による出し分けのコンポーネントテスト
- **依存タスク:** タスク1（db-errors.ts を使用）
- **対応Issue:** #143

### タスク4: deleteMember + 削除セクション UI
- [ ] 完了
- **概要:** 参照ゼロの未紐付け会員のみ hard delete できるようにする（誤登録リカバリ②）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` — `deleteMember(formData)` 追記: admin/vice_admin チェック → トランザクション内で users.id を FK 参照する全テーブル（event_attendances / events.createdBy / schedule_items.ownerId / line_channels.assignedUserId / mail_messages.triagedByUserId / mail_worker_runs.triggeredByUserId / mail_worker_jobs.requestedByUserId / tournament_drafts.approvedByUserId・rejectedByUserId / push_subscriptions / accounts / sessions）の存在チェック → 1件でもあれば「関連データがあるか LINE 紐付け済みのため削除できません。退会切替を使ってください」エラー → `DELETE WHERE id = ? AND line_user_id IS NULL`（0行もエラー）→ 成功時 redirect('/admin/members')
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.test.ts` — テスト追記: 参照ゼロ+未紐付けで削除成功、紐付け済み拒否、参照あり拒否（event_attendances 等を seed して検証）、権限
  - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx` — 未紐付け時のみ削除セクションを表示
  - `apps/web/src/app/(app)/admin/members/[id]/edit/delete-member-section.tsx` — 新規 client component。confirm ダイアログ → deleteMember 呼び出し、エラー表示
- **依存タスク:** タスク3（同一ファイル edit/actions.ts・page.tsx を編集するため順序づけ）
- **対応Issue:** #144

### タスク5: E2E テスト
- [ ] 完了
- **概要:** 登録→反映→リカバリ→self-identify 候補の一連フローを Playwright で検証。
- **変更対象ファイル:**
  - `apps/web/e2e/admin-member-create.spec.ts` — 新規。①管理者が新規会員追加→一覧に表示される ②名前を修正できる ③self-identify 候補に表示される ④削除すると一覧・self-identify 候補から消える（既存 self-identify-flow.spec.ts / grade-update.spec.ts の認証・seed パターンに準拠）
- **依存タスク:** タスク1〜4
- **対応Issue:** #145

## 実装順序

1. タスク1（依存なし）
2. タスク2（タスク1に依存）
3. タスク3（タスク1に依存）
4. タスク4（タスク3に依存）
5. タスク5（タスク1〜4に依存）

## 補足

- DB マイグレーション: なし（スキーマ変更なし）
- apps/api / packages/shared / mail-worker: 変更なし
- vitest はローカルでは `--no-file-parallelism` で逐次実行（プロジェクト既定ルール）
