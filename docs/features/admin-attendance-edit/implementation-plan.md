---
status: completed
---
# admin-attendance-edit 実装手順書

要件: [requirements.md](requirements.md)（AC は §4）。スキーマ変更なし・マイグレーション不要。

## 技術設計の骨子

- **候補絞り込みの共通化**: `apps/web/src/lib/events/eligible-users.ts`（新規）に「出欠対象ユーザーの where 条件」（`isInvited=true` ∩ 対象級。`eligibleGrades` null/空なら全級）を切り出し、`/events/[id]/page.tsx` の `eligibleUsers` クエリ・追加 Server Action の検証・編集画面の候補取得の3箇所で共有する（定義の分裂防止。要件 §6）
- **Server Actions**（`apps/web/src/app/(app)/events/[id]/actions.ts` へ追加）:
  - `adminAddAttendee(eventId, userId)` — `requireAdminSession` → イベント実在確認 → 対象ユーザーを DB から引き候補条件で fail-closed 検証（対象級外・級未設定・`isInvited=false`・存在しない ID は throw）→ `event_attendances` へ upsert（SET は `attend: true, updatedAt` のみ。**comment キーを含めない**＝既存コメント保持）
  - `adminRemoveAttendee(eventId, userId)` — `requireAdminSession` → イベント実在確認 → `DELETE ... WHERE event_id AND user_id AND attend=true`（不参加回答の行は消さない）
  - 両方とも通知系（claim / push）を一切呼ばない。revalidate 対象: `/events/[id]`・`/events/[id]/edit`・`/events`・`/events-archive`・`/admin/entries`・`/admin/entries/[entryGroupId]`・`/dashboard`
- **データ取得**: `apps/web/src/lib/events/attendance-edit.ts`（新規）に編集画面用ローダー（参加者一覧＝`attend=true` 全行 join users〔id・name・grade・role〕＋ 追加候補＝候補条件 − 参加済み）を置き、テスト DB で直接テスト可能にする。参加者一覧には**対象級外の stale 行も含め**、行ごとに「対象級外」フラグを添える（編集画面で見えるのに詳細ページに出ない理由を管理者へ示すため）
- **UI**: `apps/web/src/components/events/attendance-edit-section.tsx`（新規・`'use client'`）。`/events/[id]/edit/page.tsx` の `EventForm` の**外**（下）に独立セクションとして描画。参加者行＝氏名＋級添字＋ゲスト印（`roleViewLabel('guest')`。詳細ページの参加者欄と同じ最小表現）＋対象級外マーク＋削除ボタン。追加＝検索入力（クライアント側絞り込み）＋候補選択→追加。操作は `useTransition` + エラー表示、反映は Server Action の `revalidatePath` に委ねる（フォームの保存とは独立）
- **テスト規約**: `@/test-utils/db`・`@/test-utils/seed`（`createAdmin` / `createUser` / `createEvent` / `createEventAttendance`）・`@/test-utils/auth-mock` の既存パターン（`lifecycle-actions.test.ts` 参照）

## 実装タスク

### タスク1: 候補条件の共通化＋追加・削除 Server Actions（テストファースト）
- [x] 完了
- **目的:** 追加・削除のサーバー側実処理と fail-closed 検証を確立する
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8（候補計算のサーバー側）, AC-9
- **主な変更領域:**
  - `apps/web/src/lib/events/eligible-users.ts`（新規）＋テスト
  - `apps/web/src/lib/events/attendance-edit.ts`（新規ローダー）＋テスト
  - `apps/web/src/app/(app)/events/[id]/actions.ts`（`adminAddAttendee` / `adminRemoveAttendee` 追加）
  - `apps/web/src/app/(app)/events/[id]/admin-attendance-actions.test.ts`（新規）
  - `apps/web/src/app/(app)/events/[id]/page.tsx`（`eligibleUsers` の where をヘルパーへ差し替え。挙動不変）
- **依存タスク:** なし
- **必要なテスト:**
  - 追加: admin / vice_admin で `attend=true` upsert（ゲスト・管理者ロールも対象にできる）／対象級外・級未設定・`isInvited=false`・存在しないユーザー・存在しないイベントは throw／`attend=false`＋comment 既存行への追加で attend 反転・comment 保持／締切超過・開催日後でも成功
  - 削除: `attend=true` 行が消える／`attend=false` 行は消えない／member・guest セッションは Forbidden
  - 通知ゼロ: 追加・削除後に `event_lifecycle_notifications` が 0 件・fetch 未呼び出し
  - ローダー: 参加者一覧に対象級外 stale 行が含まれフラグが立つ／候補から参加済み・対象級外・級未設定・`isInvited=false` が除外される
- **完了条件:** 上記テスト green（`pnpm --filter=@kagetra/web test` 相当は CI 委譲。ワーカーはファイルスコープ eslint のみ）・型チェック通過
- **対応Issue:** #546

### タスク2: 編集画面の参加者セクション UI
- [ ] 完了
- **目的:** `/events/[id]/edit` から追加・削除を操作できる UI を提供する
- **対応AC:** AC-8（表示）, AC-10（出荷後の実機確認の対象画面）
- **主な変更領域:**
  - `apps/web/src/components/events/attendance-edit-section.tsx`（新規 client component）＋ jsdom テスト
  - `apps/web/src/app/(app)/events/[id]/edit/page.tsx`（ローダー呼び出し＋セクション描画）
- **依存タスク:** タスク1（Server Action・ローダーを import する）
- **必要なテスト:** jsdom — 参加者行の描画（級添字・ゲスト印・対象級外マーク）／検索でクライアント側絞り込み／削除・追加ボタンが対応する action を eventId・userId 付きで呼ぶ／候補 0 件・参加者 0 件の空表示
- **完了条件:** jsdom テスト green・型チェック通過・ファイルスコープ eslint 通過
- **対応Issue:** #547

### タスク3: 仕様書の更新
- [ ] 完了
- **目的:** docs レジストリの正典を実装と同期する
- **対応AC:** AC-9（ドキュメント整合。gate-dod の D2）
- **主な変更領域:** `docs/spec/events-attendance.md`（「出欠登録ルール」に管理者による代理追加・削除、「`/events/[id]/edit` 編集」に参加者セクションを追記。既存記述の in-place 更新・changelog 追記禁止の規律に従う）
- **依存タスク:** タスク1, タスク2（確定した実装形を記述するため）
- **必要なテスト:** なし（docs のみ）
- **完了条件:** 該当セクションが実装と一致
- **対応Issue:** #548

## 実装順序（Wave）
- Wave 1: タスク1
- Wave 2: タスク2（タスク1 に依存）
- Wave 3: タスク3（タスク1・2 に依存）

※ 3タスクとも `apps/web` 内で変更領域が接するため直列（迷ったら別 Wave の原則）。
