# 行事予定 (Schedule)

> **責務:** 練習・会議・懇親会などの行事予定を一覧・登録・編集するカレンダー的機能。出欠管理は持たない
> **関連画面:** `/schedule`（一覧）、`/schedule/[id]`（詳細）、`/schedule/new`（新規作成、管理者のみ）、`/schedule/[id]/edit`（編集、管理者のみ）
> **主要実装:**
> - `apps/web/src/app/(app)/schedule/page.tsx`
> - `apps/web/src/app/(app)/schedule/[id]/page.tsx`
> - `apps/web/src/app/(app)/schedule/new/page.tsx`
> - `apps/web/src/app/(app)/schedule/[id]/edit/page.tsx`
> - `apps/web/src/lib/form-schemas.ts`（`scheduleFormSchema` / `extractScheduleFormData`）
> - `packages/shared/src/schema/schedule-items.ts`（`scheduleItems` テーブル）
> - `packages/shared/src/schema/enums.ts`（`scheduleKindEnum`）
> - `apps/web/src/components/layout/bottom-nav.tsx`（ボトムナビ「予定」項目、`href: /schedule`）

## 機能仕様

### 責務とイベント（events）との違い

「行事予定」は `schedule_items` 1テーブルのみで完結する、シンプルなカレンダー掲示機能である。会員の出欠登録・定員・申込締切・LINE通知・大会申込などの機能は一切持たず、それらはすべて別ドメインの `events`（イベント・出欠、[spec/events-attendance.md](events-attendance.md) 参照）が担う。

行事予定のレコードは「いつ・何が・どこで行われるか」を管理者が掲示するだけの静的な情報であり、会員側に出欠回答・参加者一覧・通知トリガーは存在しない。種別（`kind`）も `practice`（練習）/ `meeting`（会議）/ `social`（懇親会）/ `other`（その他）の4種のみで、大会参加や公式行事のような複雑な属性（定員・級別定員・申込方法・参加費等）は持たない。

### 権限モデル

- **閲覧**: 認証済みセッションがあれば誰でも一覧・詳細を閲覧できる（`role` によるフィルタなし）
- **作成・編集**: `session.user.role` が `admin` または `vice_admin` の場合のみ許可。`member` はページアクセス時に `/403` へリダイレクトされる（一覧・詳細ページでは「新規作成」「編集」リンク自体が非表示になるのみで、URL直打ちに対する防御は各ページ・Server Action 内の同一チェックが担う）
- **削除**: 削除機能は実装されていない（UI・Server Action とも存在しない）

### データモデル（`schedule_items`）

カラム定義の正典は `docs/design/db.md`。行事予定ドメイン固有の挙動のみ記す。

- `date`: `date` 型・文字列モード（`YYYY-MM-DD`）。1レコード=1日固定で、期間（開始日〜終了日）の概念はない
- `kind`: `schedule_kind` enum（`practice` / `meeting` / `social` / `other`）。デフォルト `other`
- `ownerId`: 作成した管理者の `users.id`。外部キーは `ON DELETE SET NULL`（会員削除時に予定自体は残り、作成者情報だけが失われる）。ただし実際には会員削除処理（`apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts`）側で `scheduleItems.ownerId` を参照する行の存在チェックが先に走り、参照が残っている会員は削除自体がブロックされる（`FOR UPDATE` による直列化。詳細は [spec/auth-admin.md](auth-admin.md) 参照）
- `location` / `description`: 任意項目。空文字は保存時に `null` へ正規化される（`extractScheduleFormData` は空文字をそのまま渡し、`scheduleFormSchema` の `optionalStr` が `''` を `null` に変換）

## 画面

### 一覧 (`/schedule`)

`scheduleItems` を `date` の降順（`desc`）で全件取得して表示する。ページネーション・期間フィルタ・種別フィルタは存在しない。各行は日付・種別バッジ（`kindLabels` / `kindColors` で日本語ラベルと色分け）・場所（存在する場合）を表示し、クリックで詳細へ遷移する。管理者ロールの場合のみ「新規作成」リンクを表示する。

### 詳細 (`/schedule/[id]`)

URLパラメータ `id` を数値変換し、非整数または0以下なら `notFound()`。該当レコードが無い場合も `notFound()`。日付・種別・場所（存在する場合）・説明（存在する場合）を表示し、管理者ロールの場合のみ編集リンクを表示する。

### 新規作成 (`/schedule/new`)

ページ本体・Server Action の両方で管理者ロールを確認する（ページ側は未許可なら `/403` へリダイレクト、Server Action 側は未許可なら例外を投げる二重ガード）。フォーム項目は 日付（必須）・名前（必須）・種別（セレクト、デフォルト `other`）・場所（任意）・説明（任意）。

### 編集 (`/schedule/[id]/edit`)

新規作成と同様の二重ガード構成。対象レコードが存在しない場合は `notFound()`。フォームは新規作成と同一項目で、既存値を `defaultValue` として初期表示する。

## フロー

1. 管理者が `/schedule/new` からフォームを送信する
2. Server Action `createScheduleItem` が改めてセッションのロールを確認し、`scheduleFormSchema.safeParse(extractScheduleFormData(formData))` でバリデーションする
3. バリデーション失敗時は日本語エラーメッセージ（`入力が不正です: <最初のissueメッセージ>`）を含む例外を投げる（フォーム上部への表示等の専用UIは無く、Next.js のデフォルトエラー処理に委ねられる）
4. 成功時は `ownerId` にログイン中の `session.user.id` を付与して `scheduleItems` へ `insert`、作成されたレコードの `/schedule/[id]` へ `redirect`
5. 編集フローも同様だが、`ownerId` は更新対象に含めない（作成者は変更されない）。`updatedAt` は `new Date()` で明示更新し、成功後は `/schedule/[id]` へ `redirect`

## API（Server Actions）

行事予定には route handler（Hono API）は存在せず、すべて Next.js Server Actions（各ページファイル内の `'use server'` 関数）として実装されている。

- `createScheduleItem`（`apps/web/src/app/(app)/schedule/new/page.tsx` 内）: 管理者ガード → `scheduleFormSchema` バリデーション → `scheduleItems` へ insert（`ownerId` 付与）→ 詳細ページへ redirect
- `updateScheduleItem`（`apps/web/src/app/(app)/schedule/[id]/edit/page.tsx` 内）: 管理者ガード → `scheduleFormSchema` バリデーション → 対象 `id` の `scheduleItems` を update（`ownerId` は据え置き、`updatedAt` を更新）→ 詳細ページへ redirect

`revalidatePath()` の呼び出しは無い。両 Server Action とも成功時に `redirect()` するため、一覧・詳細ページは Server Component の再フェッチによって最新状態が反映される。
