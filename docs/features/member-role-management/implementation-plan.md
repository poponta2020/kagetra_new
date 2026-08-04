---
status: completed
---
# member-role-management 実装手順書

## 技術設計の要点（実装前に読む）

- **マイグレーション無し**。`user_role` enum・`users.role` 列とも既存。
- **Server Action は既存ファイルに追加**: `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` に `updateMemberRole` を足す。既存 `assertAdminSession()`（vice_admin も通る）は**使わない** — `unlinkLine` と同じく関数内で `session.user?.role !== 'admin'` を直接チェックする。
- **認可失敗は throw / 業務ルール違反は state.error**（既存 2 系統の使い分けを踏襲）。UI 側はロールセクション自体を admin にしか描画しないため、throw が画面に出ることは通常起きない。
- **競合の直列化**: 単一トランザクション内で「有効な admin 行を `FOR UPDATE` でロック → 対象行を `FOR UPDATE` でロック → 判定 → UPDATE（`WHERE` に対象条件を再掲）」の順で行う。ロック取得順を常にこの順に固定する（`deleteMember` と同じ設計）。
- **表示ラベル**は `apps/web/src/lib/role-preview.ts` の `roleViewLabel()`（管理者 / 副管理者 / 一般会員）に統一する。`apps/web/src/lib/role-label.ts` は現状どこからも使われていない別実装なので**触らない・使わない**（統合はスコープ外）。
- **AC-17（再ログイン不要で反映）は既存テストで担保済み**: `apps/web/src/lib/node-jwt-callback.test.ts` の「DB で降格された管理者は token.role が DB 値へ同期される」。新規テストは書かず、回帰として green を確認する。

## 実装タスク

### タスク1: ロール変更 Server Action `updateMemberRole`
- [ ] 完了
- **目的:** admin だけがロールを変更でき、R3 の全禁止条件をサーバー側で弾く Server Action を実装する。
- **対応AC:** AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts`（追記のみ。既存 export は変更しない）
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.role.test.ts`（新規。既存 `actions.test.ts` は肥大しているので別ファイルにする）
- **依存タスク:** なし
- **必要なテスト:**
  - 認可: vice_admin / member / 未ログイン / プレビュー中（`setAuthSession({ role: 'member', realRole: 'admin' })`）の 4 系統で拒否され DB 不変
  - 成功系: member→vice_admin / vice_admin→member / member→admin（いずれも紐付け済み・有効な行）
  - 拒否系: 未紐付けの昇格 / 退会済みの昇格 / 自分自身 / 有効 admin が自分1人（退会済み admin を別に置いたケースを含む）/ 存在しない userId / enum 外の role 値
  - 冪等: 同じロールを保存 → `success: true` でエラーにならない。未紐付け行に `member` を保存してもエラーにならない
  - `revalidatePath` が `/admin/members` と `/admin/members/[id]/edit` の両方で呼ばれる（`vi.mock('next/cache')` は既存テストと同形）
  - テストヘルパーは `@/test-utils/seed` の `createAdmin` / `createViceAdmin` / `createUser`（`lineUserId` / `deactivatedAt` は overrides で渡す）
- **完了条件:** `pnpm --filter=@kagetra/web test --no-file-parallelism` の当該ファイルが green、`pnpm check-types` 通過
- **対応Issue:** #451

### タスク2: ロールセクション UI と編集ページへの組み込み
- [ ] 完了
- **目的:** 管理者だけに見えるロール変更 UI を、既存セクションのカードパターンで会員編集画面に追加する。
- **対応AC:** AC-1, AC-18, AC-19, AC-21
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/members/[id]/edit/member-role-section.tsx`（新規・client component）
  - `apps/web/src/app/(app)/admin/members/[id]/edit/member-role-section.test.tsx`（新規・jsdom）
  - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx`（`session.user?.role === 'admin'` のときだけセクションを描画。`member.role` / `lineUserId` / `deactivatedAt` は既に取得済み）
- **依存タスク:** タスク1（`updateMemberRole` と `UpdateRoleState` を import するため）
- **必要なテスト:**
  - 現在のロールが日本語で表示される
  - 保存押下で `window.confirm` が呼ばれ、キャンセル時は action が呼ばれない／OK 時は呼ばれる
  - 自分自身の行・未紐付けの行・退会済みの行で、それぞれ理由の文言が出て該当操作ができない（昇格の選択肢が `disabled`、自分自身はフォームごと出さず理由文のみ）
  - エラーは `role="alert"`、成功は `role="status"` で表示される
  - 副管理者セッションで編集ページを描画してもロールセクションが無い（AC-1。Server Component のテストは `admin/entries/page.test.tsx` の形を踏襲）
- **完了条件:** 上記テスト green、`pnpm --filter=@kagetra/web exec eslint <変更ファイル>` 通過、`pnpm check-types` 通過
- **対応Issue:** #452

### タスク3: 会員一覧のロール列を日本語ラベル化
- [ ] 完了
- **目的:** 一覧に生の enum（`admin` / `vice_admin` / `member`）が出ている箇所を日本語にする。
- **対応AC:** AC-20
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/members/page.tsx`（ロール列のセルのみ。他の列・フォームには触らない）
  - `apps/web/src/app/(app)/admin/members/page.test.tsx`（新規）
- **依存タスク:** なし（タスク1・2 とファイルが重ならない）
- **必要なテスト:** 一覧に「管理者」「副管理者」「一般会員」が表示され、生の `vice_admin` 等が出ないこと
- **完了条件:** テスト green、`pnpm check-types` 通過
- **対応Issue:** #453

### タスク4: 仕様ドキュメントの更新
- [ ] 完了
- **目的:** `docs/spec/auth-admin.md` を実装後の事実に合わせる。
- **対応AC:** （AC 直結なし。DoD の D2 ドキュメント整合ゲート）
- **主な変更領域:** `docs/spec/auth-admin.md` のみ
  - 「RBAC（3層ロール）」: 「ロール変更 UI・Server Action は存在しない」→ 存在する旨と全禁止条件へ書き換え
  - 同節のラベル記述: `role-label.ts` の `roleLabel()` が担うという記述は実態と異なる（未使用）。ロール表示ラベルの正典が `role-preview.ts` の `roleViewLabel()` であることに修正
  - 「会員管理（`/admin/members`）」: 編集ページの操作一覧に「ロール変更」を追加
  - 「API（Server Actions）」: `updateMemberRole` を **admin のみ**として追記
  - 「既知のギャップ」: 「ロール変更 UI は存在しない」の項目を削除。代わりに「退会処理で最後の有効な管理者を退会させられる穴は未対応（別件）」を残す
- **依存タスク:** タスク1, 2, 3
- **完了条件:** 上記 5 箇所が更新済みで、docs 内に「ロール変更 UI は存在しない」旨の記述が残っていない
- **対応Issue:** #454

## 実装順序（Wave = 並行実装できるタスクの組）
- Wave 1: タスク1, タスク3（変更ファイルが完全に直交）
- Wave 2: タスク2（タスク1 に依存）
- Wave 3: タスク4（全実装確定後）
