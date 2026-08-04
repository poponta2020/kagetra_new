# 認証・会員管理

> **責務:** LINE 認証（Auth.js v5・招待制）、JWT セッションの内部ユーザー解決、3層 RBAC（admin / vice_admin / member）、招待リンク自己登録、管理者による会員管理（作成・編集・退会・削除）の仕様
> **関連画面:** `/auth/signin`、`/403`、`/register/[token]`、`/admin/members`、`/admin/members/[id]/edit`
> **主要実装:**
> - `apps/web/src/auth.ts`
> - `apps/web/src/auth.config.ts`
> - `apps/web/src/middleware.ts`
> - `apps/web/src/lib/node-jwt-callback.ts`
> - `apps/web/src/lib/role-label.ts`
> - `apps/web/src/lib/registration-invite.ts`
> - `apps/web/src/app/api/auth/[...nextauth]/route.ts`
> - `apps/web/src/app/auth/signin/page.tsx`
> - `apps/web/src/app/403/page.tsx`
> - `apps/web/src/app/register/[token]/page.tsx`
> - `apps/web/src/app/register/[token]/register-form.tsx`
> - `apps/web/src/app/register/[token]/actions.ts`
> - `apps/web/src/app/(app)/admin/members/page.tsx`
> - `apps/web/src/app/(app)/admin/members/new-member-form.tsx`
> - `apps/web/src/app/(app)/admin/members/registration-invite-section.tsx`
> - `apps/web/src/app/(app)/admin/members/actions.ts`
> - `apps/web/src/app/(app)/admin/members/_line-link-format.ts`
> - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx`
> - `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.tsx`
> - `apps/web/src/app/(app)/admin/members/[id]/edit/delete-member-section.tsx`
> - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts`
> - `packages/shared/src/schema/auth.ts`
> - `packages/shared/src/schema/registration-invites.ts`
> - `packages/shared/src/schema/enums.ts`（`user_role` / `line_link_method`）

## 機能仕様

### 認証方式（Auth.js v5・LINE のみ・招待制）

ログイン手段は LINE ログインのみ（`next-auth/providers/line`）。パスワード認証・メール認証は無い。招待制のため、会員登録は「管理者が先に会員行を作る／招待リンクを発行する」ことが前提で、未招待の LINE アカウントが勝手にログインだけして使える状態にはならない。

設定は Edge-safe な `auth.config.ts`（プロバイダ・セッション戦略・`jwt`/`session` コールバックの骨格）と、Node 専用の `auth.ts`（DB を読む `signIn` コールバックと `jwt` コールバックのラッパー）に分離している。理由はミドルウェアが Edge ランタイムで動くため。`middleware.ts` は `authConfig` のみから NextAuth インスタンスを再構築し、DB には触れない。

- **セッション戦略**: `session: { strategy: 'jwt' }`。DB アダプター（`DrizzleAdapter` 等）は使用していないため、Auth.js 標準スキーマの `accounts` / `sessions` テーブルは実際には書き込まれない（`packages/shared/src/schema/auth.ts` にスキーマ定義のみ存在）。会員削除時の参照チェック（後述）は将来アダプター導入時に備えて防御的にこの2テーブルも見ている。
- **内部ユーザー ID の解決**: Auth.js v5 の JWT 戦略 + アダプター無しでは `user.id` はサインインの都度発行されるランダム UUID であり、内部 `users.id` としては使えない。そのため `auth.config.ts` の `jwt` コールバックは LINE の `account.providerAccountId`（LINE の安定ユーザー ID）を `token.lineUserId` に退避するだけに留め、`token.lineUserId → 内部 users.id` の解決は Node 側の `nodeJwtCallback`（`apps/web/src/lib/node-jwt-callback.ts`）が担う。`session` コールバックは `token.sub` へフォールバックしない（`token.sub` は LINE の `profile.sub` であり内部 ID と別名前空間のため、フォールバックすると未紐付け状態を隠してしまう）。
- **未紐付けユーザーの扱い**: `token.id` が立たないまま（＝ `nodeJwtCallback` が対応する `users` 行を見つけられない）ログインしたユーザーは、`middleware.ts` により `/self-identify` へ強制リダイレクトされる。`/self-identify` での候補選択・紐付け処理自体は選手ドメインの仕様（[spec/players.md](players.md)）を参照。
- **退会済みユーザーの拒否**: `auth.ts` の `signIn` コールバックは LINE アカウントが `users.deactivatedAt` を持つ既存ユーザーに一致する場合、ログインを `/auth/signin?error=deactivated` へリダイレクトして拒否する（`return false` だと Auth.js 標準の `AccessDenied` になり文言を出し分けられないため専用のエラーコードを使う）。また `nodeJwtCallback` はリクエストの都度 `deactivatedAt` を再チェックし、ログイン中に退会処理された場合は `token` を `null` にしてセッション Cookie を無効化する（次回リクエストでミドルウェアが未認証扱いにする）。
- **JWT の毎リクエスト再同期**: `token.id` が確定済みの場合も `nodeJwtCallback` は毎回 DB を引き直し、`lineUserId` / `lineLinkedAt` / `lineLinkedMethod` を再同期する。これは LINE アカウント切替（account_switch）の `unstable_update` が何らかの理由で失敗した場合に、次回の Node レンダリングで自己修復させるための設計。
- **`session.update()` 経由の更新**: `auth.config.ts` の `jwt` コールバックは `trigger === 'update'` のとき、渡された patch（`lineUserId` / `lineLinkedAt` / `lineLinkedMethod`）をそのまま token に反映する。呼び出し元は `{ ...patch }` と `{ user: { ...patch } }` のどちらの形でも渡せる。

### ミドルウェアによるルーティング制御

`apps/web/src/middleware.ts` は Edge ランタイムで、セッションの有無と `session.user?.id` の有無のみで大まかなルーティングを制御する（個別の役割チェックは各ページ・Server Action 側の役目）。

- 未認証: `/auth/signin`、`/auth/error`、`/register/*` のみ通過可。それ以外は `/auth/signin` へリダイレクト。
- 認証済みだが未紐付け（`session.user.id` 無し）: `/self-identify` と `/register/*` のみ通過可。それ以外は `/self-identify` へリダイレクト。
- 紐付け済みユーザーが `/auth/signin` に来た場合、または `/register/*` に来た場合はダッシュボード（`/`）へリダイレクト。

`matcher` は LINE Webhook（`/api/webhook/line`）、LINE 一斉配信の公開エンドポイント（`/api/line-broadcast`）、無認証・無鍵の郵便番号プロキシ（`/api/zip`）、Auth.js 自体のルート（`/api/auth`）を除外している。`/api/zip` は `/register/*` 中の未紐付けユーザーが住所補完のために叩くため、ミドルウェアを通すと `/self-identify` へ弾かれて機能しなくなるという理由で明示的に除外されている。

### RBAC（3層ロール）

`users.role`（`packages/shared/src/schema/enums.ts` の `user_role` enum）は `admin` / `vice_admin` / `member` の3値。新規登録（招待リンク・管理者直接作成いずれも）のデフォルトロールは `member` で固定。登録後のロール変更は会員編集ページの「ロール」セクション（`updateMemberRole`）で行う。**変更できるのは `admin` のみ**で、以下はすべてサーバー側で拒否する:

- **実行者が `admin` 以外**。判定は他の認可と同じく実効ロール（`session.user.role`）で行うため、表示ロールをプレビュー中（下記 role-preview-switch）は変更できない。`assertAdminSession` は `vice_admin` も通すため**この操作では使わない** — 使うと副管理者が自分を `admin` へ昇格でき 3 層 RBAC が崩れる。
- **自分自身のロール変更**。誤操作で自分の管理権限を失うと DB 直接操作でしか復旧できない。
- **LINE 未紐付けの行を `admin` / `vice_admin` へ昇格**。`/self-identify` は「未紐付け ∧ 招待済み」の行を `role` を見ずに claim 可能な候補として出すため、未紐付けの管理者行は招待リンクを開いた第三者に名乗られうる。
- **退会済み（`deactivated_at` 非 NULL）の行を `admin` / `vice_admin` へ昇格**（`member` への降格は許可）。
- **有効な管理者が 0 人になる変更**。「有効」は `role = 'admin'` かつ `deactivated_at IS NULL`（退会済み管理者は `signIn` で弾かれログインできないため数に入れない）。

判定と UPDATE は単一トランザクション内で行い、ロックは常に「有効な管理者の集合（`FOR UPDATE`）→ 対象行（`FOR UPDATE`）」の順に取って直列化する。同じロールの保存は no-op として成功扱い。変更は `users.role` の書き換えのみで履歴（監査ログ）は残さない。

認可パターンは横断して同一の形（専用の共有ヘルパー関数は無く、各ファイルにローカルな `assertAdminSession` 相当の関数を都度定義する）:

- **Server Action**: 関数の先頭で `await auth()` し、`session.user?.role` が `admin` または `vice_admin` でなければ `throw new Error('Unauthorized')`。例: `apps/web/src/app/(app)/admin/members/actions.ts` の `assertAdminSession`、`apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` の同名関数。
- **より厳しい制限**: LINE 紐付け解除（`unlinkLine`）は監査上の機微操作として `vice_admin` を含めず `admin` のみに絞る、という個別の追加制限を関数内で行うケースがある。
- **ページ（Server Component）**: ページ関数の先頭で `await auth()` し、条件を満たさなければ `redirect('/403')`（例: `admin/members/page.tsx`、`admin/members/[id]/edit/page.tsx`）。`/403` はロール不足時の汎用エラーページで、メッセージ・アクションは持たない静的表示のみ。
- ロールの日本語表示ラベル（管理者 / 副管理者 / 一般会員）の正典は `apps/web/src/lib/role-preview.ts` の `roleViewLabel()`。設定シートの表示ロール切替・会員一覧のロール列・会員編集のロールセクションがこれを共有する。`apps/web/src/lib/role-label.ts` の `roleLabel()`（Pill tone 付き・`member` を「会員」にフォールバック）は現在どこからも使われていない別実装で、統合はされていない。

**role-preview-switch（表示ロールの一時プレビュー）**: `session.user.role` は上記の認可判定がそのまま参照する**実効ロール**であり、`session.user.realRole` が DB 由来の**本物のロール**を保持する。両者は通常時（プレビュー未使用）は同値。環境変数 `ROLE_PREVIEW_USER_IDS`（カンマ区切りの `users.id`）で許可されたユーザーだけが、実効ロールを本物のロール以下へ一時的に落とせる（JWT クレーム `viewAsRole` として保持。DB の `users.role` は変更しない）。実効ロールの生成点は `apps/web/src/auth.config.ts` の `session` コールバック 1 箇所のみで、ここが UI の出し分けと Server Action / route handler の認可判定の両方に同時に反映される。プレビューの開始・終了を認可する条件（許可リスト所属・切替先が本物のロール以下）は**必ず `realRole` で判定し、実効ロール（`role`）を使わない**。実効ロールで判定すると、プレビュー中に自分自身を締め出して管理者へ戻れなくなるため。切替 Server Action は `apps/web/src/app/(app)/role-preview-actions.ts`。

この認可は Server Action と JWT の update コールバック（`auth.config.ts`）の**両方**に置く。Auth.js の `POST /api/auth/session`（`useSession().update()` と同じエンドポイント）は認証済みクライアントが送った任意のペイロードを update コールバックへそのまま渡すため、Server Action 側だけの検査では迂回できてしまう。`viewAsRole: null`（プレビュー解除）だけは、どちらの層でも許可リスト判定を通さず常に受け付ける（運用中に許可リストから外れたユーザーの締め出し防止。実効ロールは下がる方向にしか動かないので権限は広がらない）。

`token.role`（＝`realRole`）は `apps/web/src/lib/node-jwt-callback.ts` の毎リクエスト DB 照合で `users.role` へ同期される。降格された管理者が降格前の `realRole` を根拠に上位の実効ロールを取り続けないようにするため。

### 招待・登録

会員登録には2つの経路があり、どちらも `users.role = 'member'` を強制する。

1. **管理者による直接作成**（`createMember` in `admin/members/actions.ts`）: 名前と級のみを入力してその場で `users` 行を作成する。`isInvited: true` / `invitedAt: now` を立てるが `lineUserId` は `null` のまま作成するため、作成直後の状態は「LINE 未紐付けの招待済み会員」であり、本人が LINE でログインして `/self-identify` から自分の行を選ぶことで紐付く（紐付き完了後の `lineLinkedMethod` は `self_identify` になる。詳細は [spec/players.md](players.md)）。
2. **招待リンクによる自己登録**（`registration_invites` テーブル + `/register/[token]`）: admin / vice_admin が有効期限プリセット（`1d` / `7d` / `30d`、既定 `7d`。`apps/web/src/lib/registration-invite.ts` の `EXPIRY_PRESETS`）を選んでリンクを発行し（`createRegistrationInvite`）、URL（`/register/<token>`）を LINE 等で共有する。招待対象者はそのリンクを開いて LINE ログイン後、姓名（漢字・ふりがな）・級・（A/B/C 級かつ全日協登録者のみ）性別/生年月日/電話/住所を入力して自分自身の `users` 行を作成する（`registerViaInvite` in `register/[token]/actions.ts`）。この経路で作られた行は最初から `lineUserId` が入り、`lineLinkedMethod = 'invite_link'` になる。

招待リンクの仕様（`registration_invites` テーブル、`packages/shared/src/schema/registration-invites.ts`）:

- トークンは `generateRegistrationToken()`（`registration-invite.ts`）が生成する 32 バイトの CSPRNG 由来 base64url 文字列（43文字）。このモジュールは管理画面（クライアントコンポーネント）からも import されるため `node:crypto` を使わず、Web Crypto グローバル（`crypto.getRandomValues`）で生成する。
- 1つのリンクは失効するまで**何人でも**使い回せる（利用回数上限は無い。配布は運用者側で制御する前提）。
- 有効性は `revokedAt IS NULL AND now() < expiresAt` の一点で判定し（`isRegistrationInviteUsable()`）、ページ描画時と `registerViaInvite` の実行時の双方でこの判定を再実行する（開いたままのタブが有効期限をまたいでも登録できないようにするため）。
- 失効（`revokeRegistrationInvite`）は明示的な取り消し操作で、`revokedAt IS NULL` を条件にした冪等な UPDATE。管理画面には有効なリンクのみを一覧表示する（`listActiveRegistrationInvites`）。
- `registration_invites` に `users` への逆参照 FK は無い。登録の監査証跡は `users.lineLinkedMethod = 'invite_link'` で十分としている。

### 会員管理（`/admin/members`）

一覧ページ（`admin/members/page.tsx`）は全会員（`users` 全行）を表示し、名前・ロール・級（インライン編集フォーム）・招待状態（`isInvited`）・登録日・LINE 紐付け日時/方法（`_line-link-format.ts` の `formatLinkedAt` / `formatLinkMethod`）・編集リンクを列挙する。退会済み（`deactivatedAt` あり）の行はグレーアウト＋「退会」バッジで視覚的に区別する。

編集ページ（`[id]/edit/page.tsx`）でできること:

- **プロフィール更新**（`updateMemberProfile`）: 級・性別・所属・段位・全日協フラグ・姓名/ふりがな・生年月日・電話・郵便番号・住所を編集する。`name`（合成表示名・UNIQUE 制約キー）自体はここでは再合成しない。
- **ロール変更**（`updateMemberRole`、`MemberRoleSection`、**`admin` 限定**）: `admin` / `vice_admin` / `member` の3択を選んで保存する（確認ダイアログあり）。拒否条件は「RBAC（3層ロール）」節を参照。UI 側では自分自身の行はフォームごと出さず理由文のみを表示し、未紐付け・退会済みの行は昇格の選択肢を無効化する（現在のロールは選択可能なまま残して降格の導線を保つ）。この無効化は誤操作を減らすための案内で、認可そのものは Server Action 側が同じ条件で判定する。
- **名前の変更**（`updateMemberName`）: LINE 未紐付けかつ `role = 'member'` の行に限定した「誤登録の取り消し」用の操作。対象条件は UPDATE の WHERE 句自体に埋め込まれており、`/self-identify` での紐付けと同時に起きる競合を単一 SQL 文で安全に弾く。
- **退会切替**（`toggleMemberDeactivation`）: `deactivatedAt` を now() / null でトグルする。退会中はログイン不可（「認証方式」節を参照）。
- **LINE 紐付け解除**（`unlinkLine`、`admin` 限定）: `lineUserId` / `lineLinkedAt` / `lineLinkedMethod` を `null` に戻す。解除後の次回ログインでは再び `/self-identify` から選び直せる。
- **削除**（`deleteMember`、`DeleteMemberSection`）: 「誤登録の取り消し」専用のハード削除。`role = 'member'` かつ `lineUserId IS NULL` の行のみが対象で、かつ 10 テーブル・11 カラムに渡る参照ゼロチェック（`eventAttendances` / `events.createdBy` / `lineChannels.assignedUserId` / `mailMessages.triagedByUserId` / `mailWorkerRuns.triggeredByUserId` / `mailWorkerJobs.requestedByUserId` / `tournamentDrafts` の承認・却下者 / `pushSubscriptions.userId` / `accounts.userId` / `sessions.userId`）をすべて通過しないと実行されない。対象行ロック（`FOR UPDATE`）→ 参照チェック → `DELETE` を単一トランザクション内で行い、チェック後に参照が増える競合（子テーブルの FK 挿入が親行の `FOR KEY SHARE` を取るため本トランザクションの完了まで待たされる）を塞ぐ。1件でも参照があれば削除を拒否し「退会処理を使ってください」という文言で案内する。

## 画面

- **`/auth/signin`**（`apps/web/src/app/auth/signin/page.tsx`）: 「LINE でログイン」ボタン1つのみの画面。`searchParams.error` に応じてエラーメッセージを出し分ける（`deactivated` / `Configuration` / `AccessDenied` / その他）。ボタン押下は Server Action で `signIn('line', { redirectTo: '/' })` を呼ぶ。
- **`/403`**（`apps/web/src/app/403/page.tsx`）: ロール不足時の静的な汎用エラー画面。
- **`/register/[token]`**（`apps/web/src/app/register/[token]/page.tsx` + `register-form.tsx`）: モバイルシェル外（ナビ無し）の単独ページ。分岐は「1. 既に紐付き済みなら `/` へ、2. トークンが無効/失効ならエラー表示のみ、3. 未ログインなら『LINE で認証する』ボタン、4. LINE ログイン済み・未紐付けなら登録フォーム」の4段。
- **`/admin/members`**（`admin/members/page.tsx`）: 会員一覧 + 会員作成フォーム（`new-member-form.tsx`）+ 招待リンク発行セクション（`registration-invite-section.tsx`、発行ダイアログでプリセット選択・URL コピー・有効リンク一覧・失効操作を提供）。
- **`/admin/members/[id]/edit`**（`[id]/edit/page.tsx` + `edit-member-form.tsx` + `member-role-section.tsx` + `delete-member-section.tsx`）: 個別会員のプロフィール編集フォーム、ロールセクション（`admin` の場合のみ表示）、LINE 紐付け情報表示 + 解除ボタン（紐付け済みの場合のみ）、退会切替ボタン、削除セクション（未紐付けの `member` の場合のみ表示）。

## フロー

### LINE ログイン（初回）

1. `/auth/signin` で「LINE でログイン」→ LINE OAuth →コールバック。
2. `auth.ts` の `signIn` コールバックが `account.providerAccountId` で `users.lineUserId` を検索し、退会済みなら `?error=deactivated` へリダイレクトして中断。
3. `auth.config.ts` の `jwt` コールバックが `token.lineUserId` に LINE ID を退避。
4. `nodeJwtCallback` が `token.lineUserId` から `users` 行を検索し、見つかれば `token.id` / `role` / `lineLinkedAt` / `lineLinkedMethod` を埋める。見つからなければ `token.id` は未設定のまま。
5. ミドルウェアが `session.user?.id` の有無を見て、未設定なら `/self-identify` へ、設定済みならそのまま目的のページへ。

### 招待リンクからの自己登録

1. admin/vice_admin が `/admin/members` で有効期限プリセットを選んでリンクを発行（`createRegistrationInvite`）。
2. 招待対象者がリンクを開く（`/register/<token>`）→トークンの有効性チェック→未ログインなら LINE ログイン（成功後も同じ `/register/<token>` に戻る）。
3. ログイン後、姓名・ふりがな・級・（該当者のみ）全日協 PII を入力して送信（`registerViaInvite`）。
4. サーバー側でトークンを再検証し、`users` 行を `role: 'member', lineLinkedMethod: 'invite_link'` で作成。`users.name`（合成名）の UNIQUE 制約違反時は「同名の会員が既に存在します」を返す。同一 LINE アカウントでの二重送信・競合時（`lineUserId` の UNIQUE 制約違反）はエラーにせずそのままダッシュボードへログインさせる。
5. `unstable_update()` でセッションの LINE 紐付けメタデータを即時反映を試みる（失敗しても次回リクエストで `nodeJwtCallback` が自己修復する）。

### 管理者による会員の是正操作

- 誤って作成した会員の名前を直す: 未紐付け＋`member` ロールの行に限り `updateMemberName` で修正可能。
- 誤登録そのものを取り消す: 未紐付け＋`member` ＋参照ゼロの行に限り `deleteMember` でハード削除。
- 本人の紐付けをやり直させたい: `admin` が `unlinkLine` で紐付けを解除し、本人の次回ログインで `/self-identify` から選び直させる。
- 退会者を復帰させたい: `toggleMemberDeactivation` は同じボタンで退会/復帰を切り替える冪等操作。
- 会員に役職を任せる／戻す: `admin` が `updateMemberRole` でロールを変更する。`token.role` は毎リクエスト DB 照合で同期されるため、対象会員は**再ログインせずに**次のリクエストから新しいロールで判定される。

## API（Server Actions）

すべて `'use server'` ファイル内の named export で、Next.js の RPC としても直接到達可能なため、各関数自身が認可チェックを行う（ページ側のガードに依存しない）。

- `apps/web/src/app/(app)/admin/members/actions.ts`
  - `createMember(prevState, formData)` — 会員直接作成。admin/vice_admin。
  - `createRegistrationInvite(preset)` — 招待リンク発行。admin/vice_admin。戻り値に完全な URL と ISO 形式の有効期限を含む。
  - `revokeRegistrationInvite(id)` — 招待リンク失効。admin/vice_admin。
  - `listActiveRegistrationInvites(now?)` — 有効な招待リンク一覧取得。admin/vice_admin。
- `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts`
  - `updateMemberProfile(prevState, formData)` — プロフィール更新。admin/vice_admin。
  - `updateMemberName(prevState, formData)` — 名前変更（未紐付け・`member` 限定）。admin/vice_admin。
  - `deleteMember(prevState, formData)` — ハード削除（未紐付け・`member`・無参照限定）。admin/vice_admin。
  - `toggleMemberDeactivation(formData)` — 退会切替。admin/vice_admin。
  - `unlinkLine(formData)` — LINE 紐付け解除。**admin のみ**。
  - `updateMemberRole(prevState, formData)` — ロール変更。**admin のみ**（実効ロールで判定）。自分自身・未紐付けの昇格・退会済みの昇格・有効な管理者が 0 人になる変更を拒否する。
- `apps/web/src/app/register/[token]/actions.ts`
  - `registerViaInvite(token, prevState, formData)` — 招待リンク経由の自己登録完了。認可は「有効な招待トークン + LINE ログイン済み」であることそのもの（ロールチェックは無い）。
- `apps/web/src/app/(app)/role-preview-actions.ts`
  - `setRolePreviewAction(formData)` — 表示ロールのプレビュー切替/解除。認可は `ROLE_PREVIEW_USER_IDS` 許可リスト所属 + 本物のロール以下への切替（`realRole` で判定、実効ロールは使わない）。

## route handler

- `apps/web/src/app/api/auth/[...nextauth]/route.ts` — `auth.ts` の `handlers`（`GET` / `POST`）をそのまま re-export するだけの Auth.js v5 標準エンドポイント。

## 既知のギャップ・未確認事項

- 退会処理（`toggleMemberDeactivation`）には「最後の有効な管理者を退会させられる」穴が残っている。ロール変更（`updateMemberRole`）側は有効な管理者が 0 人になる変更を拒否するが、退会切替は同じ保護を持たない。この経路で全管理者が退会するとログインできる管理者が居なくなり、DB 直接操作でしか復旧できない（未対応・別件）。
- 本人性検証（招待された本人が本当にログインしているか）は招待制であることを理由に意図的に省略されている（[docs/features/invite-link-registration/requirements.md](../features/invite-link-registration/requirements.md) 参照）。
