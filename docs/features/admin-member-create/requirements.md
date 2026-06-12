---
status: completed
---
# admin-member-create 要件定義書

新規会員登録（管理画面からの手動追加）

## 1. 概要

- **目的**: 新入会員の users 行を管理画面から作成できるようにし、既存の LINE ログイン → /self-identify claim フローに乗せる正規の登録経路を作る。
- **背景**: 現状、会員行を作る手段が `seed-initial-admin.ts`（初期管理者専用）と DB 直 INSERT しかなく、新入会員をアプリに迎え入れる正規の経路が存在しない。旧 kagetra からの一括データ移行は Phase 4 後だが、それまでに入会する新会員・移行後に入会する会員の両方でこの機能が必要。

## 2. ユーザーストーリー

- **対象ユーザー**: 管理者（admin）および副管理者（vice_admin）
- **ユーザーの目的**: 新入会員の入会手続き時に、その場で会員をアプリに登録し、本人に LINE ログインを案内する
- **利用シナリオ**:
  1. 新入会員の入会が決まる
  2. 管理者/副管理者が管理画面の会員管理から「新規会員追加」で名前（+級）を登録（作成時点で招待済み = self-identify の候補に出る）
  3. 本人に「LINE でログインして自分の名前を選んでください」と案内
  4. 本人が LINE ログイン → /self-identify で自分の名前を選択 → 紐付け完了、アプリ利用開始
- **ゴール**: 新会員がイベント出欠等のアプリ機能を使える状態になるまでを、DB を触らずに管理画面だけで完結させる

## 3. 機能要件

### 3.1 新規会員登録フォーム
- 配置: `/admin/members`（会員一覧ページ）上部に「新規会員追加」ボタン → インラインフォーム展開（ページ遷移なし）
- 入力項目: **名前（必須）+ 級（任意、A〜E または未設定）** のみ。他のプロフィール（性別・所属・段・全日協）は登録後に既存の編集ページで入力する運用
- 作成される行: `isInvited=true` / `invitedAt=now`（即招待済み = 即 self-identify 候補に出る）、`role='member'` 固定、`lineUserId=null`
- 登録成功後: 一覧に即反映、フォームはリセット
- バリデーション:
  - 名前: trim 後に非空必須、最大50文字
  - 名前重複（users.name UNIQUE 違反）: 「同名の会員が既に存在します（退会済み会員を含む）」エラーをフォームに表示。復会が適切な場合は管理者が判断して既存の退会切替を使う
  - 級: A〜E の enum 値または未設定のみ受理（不正値は拒否）

### 3.2 誤登録リカバリ① 未紐付け会員の名前編集
- 既存の編集ページ（`/admin/members/[id]/edit`）の名前欄を、**LINE 未紐付け（lineUserId が NULL）の会員に限り編集可能**にする
- 紐付け済み会員は従来通り readOnly（「ユーザー名はログインに使われるため変更不可」の現行仕様を維持）
- サーバー側でも未紐付け条件を UPDATE の WHERE に含めて二重防御（claim との race 対策）
- 名前重複時は 3.1 と同様のエラー表示

### 3.3 誤登録リカバリ② 未紐付け会員の削除
- 編集ページに削除ボタンを追加（未紐付けの member のみ表示、確認ダイアログ必須）
- 削除条件（すべて満たす場合のみ hard delete）:
  - `role` が `member`（admin / vice_admin 行は削除不可。RBAC 破壊防止、Codex R1 指摘で追加）
  - `lineUserId` が NULL（未紐付け）
  - users.id を FK 参照する全テーブルで対象行が 0 件（1件でもあれば拒否）
- 条件を満たさない場合: 「この会員には関連データがあるか LINE 紐付け済みのため削除できません。退会切替を使ってください」エラー
- 背景: `unlinkLine` は `lineLinkedAt` も消すため「未紐付け」だけでは新規未使用と断定できない。event_attendances が CASCADE のため、参照チェックなしで削除すると出欠履歴が静かに消える事故になる

### 3.4 ビジネスルール・エラーケースまとめ
- 操作権限: 登録・名前編集・削除すべて admin + vice_admin（既存の会員管理画面と同じ権限ライン。削除は「登録の取り消し（undo）」と位置づけ、参照チェックで実害を限定）
- 同姓同名の会員は登録不可（DB UNIQUE 制約。実運用では表記ゆらぎで回避する想定）
- 退会済み会員の再入会は既存の退会切替（復会）で対応し、本機能のスコープ外
- ロール変更 UI は本機能のスコープ外（別機能として扱う）

## 4. 技術設計

### 4.1 API設計
- **Hono API（apps/api）: 変更なし**。会員管理は既存方針どおり Next.js Server Actions で完結
- Server Actions（3本）:

| Action | 配置 | 入力 | 処理 |
|---|---|---|---|
| `createMember` | `admin/members/actions.ts`（新規ファイル） | name, grade | 権限チェック → zod 検証 → INSERT（role='member', isInvited=true, invitedAt=now）→ 23505 はフォームエラー化 → revalidatePath |
| `updateMemberName` | `admin/members/[id]/edit/actions.ts`（追記） | userId, name | 権限チェック → zod 検証 → `UPDATE ... SET name WHERE id = ? AND line_user_id IS NULL`（単文 race-safe）→ 0行なら「紐付け済み」エラー、23505 は重複エラー |
| `deleteMember` | `admin/members/[id]/edit/actions.ts`（追記） | userId | 権限チェック → トランザクション内で FK 参照テーブルの存在チェック → `DELETE WHERE id = ? AND line_user_id IS NULL` → 0行/参照ありはエラー → 成功時 `/admin/members` へ redirect |

- `createMember` / `updateMemberName` は `useActionState` パターン（既存 `updateMemberProfile` と同型）でエラーをフォームに返す
- UNIQUE violation 判定は self-identify の `isUniqueViolation`（code 23505、cause 掘り）と同じ手法を共通化して流用

### 4.2 DB設計
- **スキーマ変更なし、マイグレーション不要**。users の既存カラム（name UNIQUE / grade / isInvited / invitedAt / role）で完結
- deleteMember の参照チェック対象（users.id を FK 参照する全テーブル）:
  - event_attendances.userId（CASCADE）
  - events.createdBy（NO ACTION）
  - schedule_items.ownerId（SET NULL）
  - line_channels.assignedUserId（SET NULL）
  - mail_messages.triagedByUserId（SET NULL）
  - mail_worker_runs.triggeredByUserId（SET NULL）
  - mail_worker_jobs.requestedByUserId（CASCADE）
  - tournament_drafts.approvedByUserId / rejectedByUserId（SET NULL）
  - push_subscriptions.userId（CASCADE）
  - accounts.userId / sessions.userId（CASCADE、JWT 運用では実質未使用だが念のため対象に含める）
- CASCADE/SET NULL に頼らず「1件でも参照があれば削除拒否」の一律ルール（履歴消失・監査ポインタ消失を防ぐ fail-safe）

### 4.3 フロントエンド設計
- `new-member-form.tsx`（新規 client component）: 「新規会員追加」ボタンで開閉する折りたたみフォーム。名前 input + 級 select + 登録ボタン。`useActionState` でエラー/成功表示、成功時リセット
- `admin/members/page.tsx`: 一覧の上に `NewMemberForm` を設置（ページ自体の admin/vice_admin ガードは既存のまま）
- `edit-member-form.tsx`: `lineLinked: boolean` prop を追加。未紐付け時は名前を編集可能な独立小フォーム（プロフィール保存フォームとは分離して誤爆防止）+ 注記文言を切替。紐付け済みは現行 readOnly 維持
- 編集ページに削除セクション追加（未紐付け時のみ表示、`confirm()` ダイアログ → `deleteMember`）

### 4.4 バックエンド設計（処理フロー）
1. createMember: assertAdminSession（admin/vice_admin）→ zod（name: trim/1-50字、grade: enum or null）→ INSERT → 成功: revalidatePath('/admin/members') / 23505: エラー state
2. updateMemberName: assertAdminSession → zod → 条件付き UPDATE（0行 = 紐付け済み or 不在）→ revalidatePath（一覧 + 編集ページ）
3. deleteMember: assertAdminSession → tx 内で参照存在チェック（4.2 の全テーブル）→ 条件付き DELETE → redirect('/admin/members')

## 5. 影響範囲

- **変更ファイル**:
  - `apps/web/src/app/(app)/admin/members/page.tsx` — フォーム設置
  - `apps/web/src/app/(app)/admin/members/actions.ts` — 新規（createMember）
  - `apps/web/src/app/(app)/admin/members/new-member-form.tsx` — 新規
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` — updateMemberName / deleteMember 追記
  - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx` — lineLinked の受け渡し、削除セクション
  - `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.tsx` — 名前編集の条件付き解禁
- **既存機能への影響**:
  - /self-identify: **変更なし**（isInvited=true の未紐付け行は既存クエリで自動的に候補に出る）
  - 既存の編集ページの挙動: 紐付け済み会員については一切変化なし
  - packages/shared / apps/api / mail-worker: 変更なし
- **テスト**:
  - 新規: `admin/members/actions.test.ts`（createMember: 正常系/重複/権限/バリデーション）
  - 追記: `admin/members/[id]/edit/actions.test.ts`（updateMemberName: 未紐付け成功/紐付け済み拒否/重複、deleteMember: 成功/紐付け済み拒否/参照あり拒否/権限）
  - E2E 追加: 管理者が会員追加 → 一覧反映 → self-identify 候補に表示（既存 `self-identify-flow.spec.ts` / `grade-update.spec.ts` のパターンに準拠）

## 6. 設計判断の根拠

- **管理画面手動追加方式**: 既存の招待制 + self-identify モデル（本人性検証なし＝身内アプリでリスク受容済み、2026-04-22 確定）にそのまま乗る最小構成。招待リンク/QR はトークン管理が増え、自己申請+承認制は招待制の前提を崩すため不採用
- **名前+級のみの入力**: 出欠・試合に直結する級だけ登録時に入れ、残りは既存の編集ページに委譲。フォームの重複実装を避ける
- **即招待済み（isInvited=true）**: 「枠だけ作って後で招待」のユースケースがないため 1 ステップに簡素化
- **role は member 固定**: ロール変更は現状 UI 自体が存在せず、権限設計（副管理者が admin を作れるか等）の検討が必要なため別機能に分離（1PR=1機能）
- **削除は参照ゼロの未紐付け行限定**: unlinkLine が lineLinkedAt を消すため「未紐付け = 新規未使用」と断定できず、event_attendances の CASCADE で履歴が静かに消える事故を防ぐ fail-safe 設計。条件を満たさないケースは既存の退会切替で代替
- **削除も admin + vice_admin**: 削除は「登録の取り消し」と位置づけ、登録と同じ権限ライン。参照チェックにより破壊可能な対象が誤登録直後の行に実質限定されるため、unlinkLine（admin 限定）ほどの監査的重さはないと判断
- **race 対策は単文 WHERE ガード**: self-identify の claim と管理操作（名前変更/削除）が競合しても、UPDATE/DELETE の WHERE に `line_user_id IS NULL` を含めることで明示ロックなしに直列化（self-identify 実装と同じパターン）
