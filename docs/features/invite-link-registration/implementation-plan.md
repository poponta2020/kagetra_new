---
status: completed
---
# invite-link-registration 実装手順書

要件定義書: `docs/features/invite-link-registration/requirements.md`
親Issue: #173

テストファースト（API/lib テスト → 実装 → フロント → E2E）で進める。マイグレーションの新規連番は **0030**（`drizzle-kit generate` で確定）。

## 実装タスク

### タスク1: DB スキーマ（registration_invites）＋ enum invite_link ＋ 型横断更新 ＋ マイグレーション
- [x] 完了
- **概要:** 招待トークンを保持する新規テーブルを追加し、`line_link_method` enum に `invite_link` を追加。enum 追加に伴う TS 文字列リテラル型を横断更新する。
- **変更対象ファイル:**
  - `packages/shared/src/schema/registration-invites.ts`（新規）— `id` / `token`(UNIQUE) / `expires_at` / `created_by`(FK→users.id) / `created_at` / `revoked_at`。[attachment-share-tokens.ts](packages/shared/src/schema/attachment-share-tokens.ts) のパターンを踏襲
  - `packages/shared/src/schema/index.ts` — 新テーブルを export
  - `packages/shared/src/schema/relations.ts` — 必要なら createdBy → users の relation（一覧で発行者表示する場合のみ。不要なら省略）
  - [packages/shared/src/schema/enums.ts](packages/shared/src/schema/enums.ts) — `lineLinkMethodEnum` に `'invite_link'` 追加
  - [apps/web/src/auth.config.ts](apps/web/src/auth.config.ts) — `lineLinkedMethod` の型 union に `'invite_link'` 追加（jwt/session 両コールバック）
  - [apps/web/src/next-auth.d.ts](apps/web/src/next-auth.d.ts) — Session/JWT 型の `lineLinkedMethod` union に追加
  - [apps/web/src/lib/node-jwt-callback.ts](apps/web/src/lib/node-jwt-callback.ts) — 型が enum を参照していれば追従
  - `packages/shared/drizzle/0030_*.sql` — `drizzle-kit generate` で生成（CREATE TABLE ＋ ALTER TYPE ADD VALUE）
- **依存タスク:** なし
- **対応Issue:** #174

### タスク2: registration-invite ライブラリ（純関数）＋ ユニットテスト
- [x] 完了
- **概要:** トークン生成・有効期限算出・検証の純関数を実装。[invite-code.ts](apps/web/src/lib/invite-code.ts) / [invite-code.test.ts](apps/web/src/lib/invite-code.test.ts) のパターンを踏襲し、DB 非依存でテスト可能にする。
- **変更対象ファイル:**
  - `apps/web/src/lib/registration-invite.ts`（新規）— `generateRegistrationToken()`（`crypto.randomBytes(32).toString('base64url')`）／`registrationInviteExpiresAt(preset, now?)`（preset: `'1d'|'7d'|'30d'`）／`isRegistrationInviteExpired(expiresAt, now?)`／`EXPIRY_PRESETS` 定義
  - `apps/web/src/lib/registration-invite.test.ts`（新規）— 期限算出・失効判定・プリセット網羅のテスト（先に作成）
- **依存タスク:** なし
- **対応Issue:** #175

### タスク3: 発行／無効化 Server Actions ＋ テスト
- [ ] 完了
- **概要:** 管理者が招待リンクを発行・無効化するアクション。authz は `admin`/`vice_admin`（createMember と同一）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/members/actions.ts`（拡張）— `createRegistrationInvite(preset)`（authz → INSERT → 完全URL を返す。`NEXT_PUBLIC_APP_URL` 等のベースURL利用）／`revokeRegistrationInvite(id)`（authz → `revoked_at=now` UPDATE）／有効リンク取得用クエリ
  - `apps/web/src/app/(app)/admin/members/actions.test.ts`（拡張）— 権限拒否（member）／発行で行作成＋URL形状／無効化で revoked_at セット、をテスト DB で検証（先に作成）
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #177

### タスク4: 登録確定 Server Action（registerViaInvite）＋ テスト
- [ ] 完了
- **概要:** トークンを再検証し、セッションの LINE ユーザーIDで会員レコードを作成・紐付けするアクション。self-identify の claim と createMember の INSERT を組み合わせた形。
- **変更対象ファイル:**
  - `apps/web/src/app/register/[token]/actions.ts`（新規）— `registerViaInvite(token, formData)`:
    1. `session.user.id` 有り → `/` へ。`lineUserId` 無し → `/register/<token>` で再ログイン誘導
    2. トークン再検証（`revoked_at IS NULL` かつ未失効）。無効 → エラー
    3. 入力 zod 検証（name 必須1〜50 / grade A〜E nullable、createMember の schema 流用）
    4. `users` INSERT（role='member', isInvited=true, invitedAt, lineUserId, lineLinkedAt, lineLinkedMethod='invite_link'）。`users.name` / `users.line_user_id` の UNIQUE 違反を文言ハンドリング
    5. `unstable_update` → `revalidatePath('/')` → `redirect('/')`
  - `apps/web/src/app/register/[token]/actions.test.ts`（新規）— 期限切れ拒否／正常作成（role/method/紐付け）／同名衝突／同一LINE二重作成のガード（先に作成）
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #178

### タスク5: middleware の /register/* ルーティング拡張
- [x] 完了
- **概要:** `/register/*` を新カテゴリとして扱い、未ログイン通過・未紐付け時の self-identify 例外・紐付け済みは `/` へ、を実装。
- **変更対象ファイル:**
  - [apps/web/src/middleware.ts](apps/web/src/middleware.ts) — `REGISTER_PREFIX = '/register'` を追加し、(1) `!session` かつ register → 通す、(2) `session && !user.id` かつ register → 通す（self-identify 強制の例外）、(3) `session && user.id` かつ register → `/` へ
- **依存タスク:** なし（型は タスク1 と独立）
- **対応Issue:** #176
- **備考:** middleware の単体テストは無いため、ルーティング挙動は タスク8 の E2E で担保する。

### タスク6: 登録ページ /register/[token] UI ＋ フォーム
- [ ] 完了
- **概要:** トークン状態に応じて出し分ける登録ページ。signin / self-identify と同じ独立レイアウト（`(app)` 外）。
- **変更対象ファイル:**
  - `apps/web/src/app/register/[token]/page.tsx`（新規, Server Component）— トークン検証 → 無効/期限切れ=エラー表示、未ログイン=ウェルカム＋「LINEで登録」（server action `signIn('line', { redirectTo: '/register/<token>' })`）、未紐付け=登録フォーム、紐付け済み=`/` へ
  - `apps/web/src/app/register/[token]/register-form.tsx`（新規, Client）— 氏名（必須）＋級（任意セレクト）フォーム。`registerViaInvite` を呼ぶ。エラー表示
  - 必要に応じて `apps/web/src/app/register/layout.tsx`（独立レイアウトが必要な場合）
- **依存タスク:** タスク4, タスク5
- **対応Issue:** #180

### タスク7: 会員管理画面に招待リンク発行セクション ＋ モーダル ＋ 有効リンク一覧
- [ ] 完了
- **概要:** 管理画面に発行UIを追加。発行後モーダルでURL/期限/コピーを表示し、有効リンク一覧と無効化ボタンを出す。
- **変更対象ファイル:**
  - [apps/web/src/app/(app)/admin/members/page.tsx](apps/web/src/app/(app)/admin/members/page.tsx)（拡張）— 「招待リンク」セクション（期限プリセット選択＋発行ボタン＋有効リンク一覧＋無効化）
  - `apps/web/src/components/admin/RegistrationInviteModal.tsx`（新規, Client）— URL/残り時間カウントダウン/失効日時/コピー。[InviteCodeModal](apps/web/src/components/events/InviteCodeModal.tsx) を参考に新規作成
- **依存タスク:** タスク3
- **対応Issue:** #179

### タスク8: E2E（Playwright）招待リンク発行→登録→ログイン フロー
- [ ] 完了
- **概要:** 発行から登録・ログイン到達までの主要動線、期限切れ拒否、未ログイン→（LINE モック）→フォーム→作成を検証。
- **変更対象ファイル:**
  - `apps/web/e2e/invite-link-registration.spec.ts`（新規）— [self-identify-flow.spec.ts](apps/web/e2e/self-identify-flow.spec.ts) / [admin-member-create.spec.ts](apps/web/e2e/admin-member-create.spec.ts) の認証モック（[playwright-auth.ts](apps/web/src/test-utils/playwright-auth.ts)）を流用
- **依存タスク:** タスク6, タスク7
- **対応Issue:** #181

## 実装順序
1. タスク1 #174（DB スキーマ＋enum＋型）— 依存なし、基盤
2. タスク2 #175（lib 純関数＋テスト）— 依存なし
3. タスク5 #176（middleware）— 依存なし（並行可）
4. タスク3 #177（発行/無効化 actions）— タスク1,2 に依存
5. タスク4 #178（登録確定 action）— タスク1,2 に依存
6. タスク7 #179（発行UI＋モーダル）— タスク3 に依存
7. タスク6 #180（登録ページUI）— タスク4,5 に依存
8. タスク8 #181（E2E）— タスク6,7 に依存
