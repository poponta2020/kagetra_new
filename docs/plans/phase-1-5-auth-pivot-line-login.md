# Phase 1-5 Auth Pivot: Credentials → LINE Login + Self-Identify

> **ステータス**: plan 作成済み (2026-04-21)、ユーザー承認後 `/claude-mem:do` で実行
> **スコープ**: 1 PR。Credentials 完全除去 + LINE Login (Auth.js built-in) + /self-identify + admin 監査
> **関連**: PR #3 (Credentials 導入) と PR #4 (LINE link / profile 追加) の一部を差し戻し・再設計

## 背景

Apr 18 に旧会員 66 名の identity 紐付け困難を理由に LINE Login → Credentials (username+password+bcrypt) へ変更し PR #3 で ship。Apr 21 に方針再検討し、「LINE login → 未リンクなら /self-identify で本人選択 → 即時紐付け」の自己申告フロー (事後 admin モニター方式 = option C) で解決することに。

## 合意済み設計決定

| # | 決定 | 備考 |
|---|---|---|
| A1 | Auth.js built-in LINE provider を使う（自前 OAuth2 route は account switch 用のみ残す） | `next-auth/providers/line` |
| A2 | `/self-identify`: `lineUserId IS NULL AND isInvited AND deactivatedAt IS NULL` の会員一覧から本人選択 → 即時 `users.lineUserId` 紐付け | 即時＋事後監査 (option C) |
| A3 | 監査は `users.line_linked_at` timestamptz + `users.line_linked_method` enum (`self_identify` / `admin_link` / `account_switch`) で記録。admin 画面は最近順ソート + 解除ボタン | 専用 audit テーブルは作らない (option 1.a) |
| A4 | 全部 1 PR でマージ（ログインが壊れた中間状態を作らない） | option 2.a |
| A5 | `/settings/line-link` は「別 LINE へ切替」機能として残す。切替成立時は `line_linked_method='account_switch'` で記録 | 既存 route / line-oauth.ts / state cookie HMAC は再利用 |

---

## Phase 0: Documentation Discovery (完了済み)

### Auth.js v5 LINE provider 実装ファクト

**Sources**: https://authjs.dev/getting-started/providers/line, https://authjs.dev/guides/upgrade-to-v5, https://authjs.dev/getting-started/adapters/drizzle

**確定している API**:
```ts
import Line from 'next-auth/providers/line'

// providers 配列に追加
Line({
  clientId: process.env.AUTH_LINE_ID,
  clientSecret: process.env.AUTH_LINE_SECRET,
})
```

- 環境変数は `AUTH_LINE_ID` / `AUTH_LINE_SECRET` が Auth.js 規約 (既存 `LINE_LOGIN_CHANNEL_ID/SECRET` は PR #4 導入の自前 OAuth 用。**両方保持**：Auth.js は `AUTH_LINE_*`、account switch 用の自前 OAuth は既存 `LINE_LOGIN_*` を使う)
- Profile は OIDC 準拠: **LINE user ID は `profile.sub`** (not `userId`)
- `profile` callback を省略すると `id = profile.sub`, `name = profile.name`, `image = profile.picture` が Auth.js のデフォルトでマップされる
- **Edge 安全**: providers 配列を `auth.config.ts` (Edge-safe) にそのまま書いてよい
- **JWT 戦略 + adapter なしで動作**: `accounts` テーブルの row 作成は不要。`jwt({ token, user })` の初回呼び出しで `user.id = profile.sub` が入っているので、`token.lineUserId = user.id` で JWT に載せる
- **`signIn` callback で拒否可能**: deactivated チェックは `signIn({ user })` 内で DB を引いて return false すれば、JWT 自体が発行されずセッション成立しない

### 既存コード inventory (確定事実)

Inspection 済み、詳細は省略。差し戻し・流用・新規の各リスト:

**削除確定** (Phase 6):
- `apps/web/src/app/login/` 全削除
- `apps/web/src/app/change-password/` 全削除
- `apps/web/src/lib/credentials-authorize.ts`
- bcrypt 依存 (`apps/web/package.json`, pnpm-lock)
- `apps/web/e2e/login-flow.spec.ts`
- `apps/web/src/app/login/actions.test.ts`, `apps/web/src/app/change-password/actions.test.ts`

**更新** (Phase 2-5):
- `apps/web/src/auth.ts`: Credentials → 何も provider 足さない (auth.config.ts 側で Line 追加)、`nodeJwtCallback` 呼び出しは簡略化 (deactivation check のみ残す)、`unstable_update` export 維持
- `apps/web/src/auth.config.ts`: Line provider 追加、`pages.signIn` を `/auth/signin` (後述、新規作成) or Auth.js デフォルト、JWT callback で lineUserId / lineLinkedAt 伝播、`mustChangePassword` 分岐全除去
- `apps/web/src/middleware.ts`: `mustChangePassword` gate 削除 (L46-53)、`lineUserId` gate を `/self-identify` へリダイレクトするように書き換え (L58-66)、`PUBLIC_PATHS` を `['/auth/signin', '/auth/error']` に変更
- `apps/web/src/next-auth.d.ts`: `mustChangePassword` 削除、`lineUserId` 維持、`lineLinkedAt` と `lineLinkedMethod` 追加 (admin UI で参照するため)
- `apps/web/src/lib/node-jwt-callback.ts`: 簡略化 — deactivated 検知だけ残す (lineUserId の self-heal は LINE provider 任せ)
- `apps/web/src/test-utils/auth-mock.ts`, `seed.ts`, `playwright-auth.ts`: `mustChangePassword` 除去
- `packages/shared/src/schema/auth.ts`: `passwordHash` / `mustChangePassword` カラム削除、`lineLinkedAt` / `lineLinkedMethod` 追加
- `packages/shared/src/schema/enums.ts`: `lineLinkMethodEnum` 追加
- `apps/web/e2e/line-link-flow.spec.ts`: account switch 用に書き換え (既存 `LINE_OAUTH_TEST_MODE` 経路は account switch 用として維持)

**新規作成** (Phase 2-5):
- `apps/web/src/app/auth/signin/page.tsx`: LINE ログインボタン 1 個だけの最小ページ
- `apps/web/src/app/self-identify/page.tsx`: 未リンク会員一覧 + ラジオ選択フォーム
- `apps/web/src/app/self-identify/actions.ts`: `claimMemberIdentity(userId: string)` Server Action
- `apps/web/src/app/self-identify/actions.test.ts`: Vitest
- `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` に `unlinkLine(userId: string)` を追加 (Admin only)
- `apps/web/src/app/(app)/admin/members/page.tsx` に 2 列追加 (LINE 紐付け日時 / 方法)
- `apps/web/e2e/self-identify-flow.spec.ts`: 新規 E2E
- マイグレーション: `0004_auth_pivot_line_login.sql` (drizzle-kit 自動生成、命名は auto)

### 流用する既存資産

| 資産 | 流用先 |
|---|---|
| `apps/web/src/lib/line-oauth.ts` (state cookie HMAC, zod profile 検証) | `/settings/line-link` account switch フローでそのまま使う |
| `apps/web/src/app/api/line-link/callback/route.ts` | 内部ロジックを account switch 専用に変更 (成立時は `line_linked_method='account_switch'` 記録) |
| `apps/web/src/app/api/line-link/callback/route.test.ts` | テストロジックはほぼ流用、期待値だけ更新 |
| `apps/web/src/test-utils/playwright-auth.ts:encode` | JWT 直接注入で self-identify / admin テストを組む (LINE OAuth モックは不要) |

---

## Phase 1: Schema 変更 + memory / docs 更新

### 目的
PR #3/#4 由来の `passwordHash` / `mustChangePassword` カラム除去と、自己申告監査用の `lineLinkedAt` / `lineLinkedMethod` カラム追加を先行させる。マイグレーションだけ別 phase にすることで、後続の TypeScript 変更時にランタイム schema との齟齬を最小化。

### 実装タスク

1. `packages/shared/src/schema/enums.ts`: 新規 enum を末尾に追加:
   ```ts
   export const lineLinkMethodEnum = pgEnum('line_link_method', [
     'self_identify',
     'admin_link',
     'account_switch',
   ])
   ```

2. `packages/shared/src/schema/auth.ts`:
   - `import` 行に `lineLinkMethodEnum` 追加
   - `users` テーブルから `passwordHash`, `mustChangePassword` 行を削除
   - 下記 2 行を新規追加 (位置: `deactivatedAt` と `createdAt` の間):
     ```ts
     lineLinkedAt: timestamp('line_linked_at', { mode: 'date', withTimezone: true }),
     lineLinkedMethod: lineLinkMethodEnum('line_link_method'),
     ```
   - `check` constraint は `users_dan_range` のみそのまま残す

3. マイグレーション生成:
   ```
   pnpm --filter=@kagetra/shared db:generate --name auth_pivot_line_login
   ```
   - 生成物: `packages/shared/drizzle/0004_<auto>_auth_pivot_line_login.sql` + snapshot 0004

4. 生成 SQL の目視確認 (期待):
   - `CREATE TYPE "public"."line_link_method" AS ENUM(...)`
   - `ALTER TABLE "users" DROP COLUMN "password_hash"`
   - `ALTER TABLE "users" DROP COLUMN "must_change_password"`
   - `ALTER TABLE "users" ADD COLUMN "line_linked_at" timestamp with time zone`
   - `ALTER TABLE "users" ADD COLUMN "line_link_method" "line_link_method"`

5. `docs/phase-1-5-migration-plan.md` 更新:
   - §3.4 migrate-users.ts 内、`passwordHash = bcrypt('pppppppp', 12)` と `mustChangePassword = true` の行を削除
   - 代わりに「`lineUserId = NULL, isInvited = true, invitedAt = 旧 created_at, lineLinkedAt = NULL, lineLinkedMethod = NULL` で seed → 各会員が LINE login 後に /self-identify で自己申告」と記載
   - 初期パス配布 / `pppppppp` の運用記述を全削除
   - §末尾に「アナウンス文面例」ブロックを新設 (LINE グループ投稿用のテンプレート)

6. `.claude/memory/project_kagetra_new_design.md` 更新:
   - #3 を書き換え: "Credentials は Apr 18 に一時採用したが Apr 21 に LINE Login へ戻す決定。自己申告フロー (option C 事後監査) で 66 会員問題を解決。PR #3 (`a3f99d3` など) と PR #4 の一部を PR #5 で差し戻し"
   - #17 は現状維持 (JWT session は LINE login でも継続)
   - 末尾に #18 を追加: "LINE 紐付けの監査は `users.line_linked_at`/`line_linked_method` で記録。admin 画面から解除 (`admin_link` → NULL) すると該当会員が /self-identify で再選択可能"

### 検証チェックリスト (Phase 1)

- [ ] `pnpm --filter=@kagetra/shared check-types` PASS
- [ ] 生成された `0004_*.sql` の SQL が期待と一致
- [ ] `pnpm test:db:up && pnpm --filter=@kagetra/shared db:push --force` でテスト DB に適用成功
- [ ] snapshot ファイル `meta/0004_snapshot.json` の `line_link_method` enum 定義が `['self_identify','admin_link','account_switch']`
- [ ] `docs/phase-1-5-migration-plan.md` から "bcrypt" / "pppppppp" / "mustChangePassword" の grep 結果が 0 件 (注: 移行計画書内に限る。コード側は Phase 6 で)
- [ ] memory ファイル差分が意図通り

### Anti-pattern ガード (Phase 1)

- ❌ SQL 手書きで 0004 を作らない (必ず drizzle-kit generate)
- ❌ 既存 0000-0003 の migration を改変しない (journal と齟齬が出る)
- ❌ `text + CHECK` で line_link_method を作らない → `pgEnum` に統一 (codebase 規約、enums.ts 参照)

---

## Phase 2: Auth 基盤差し替え (provider swap)

### 目的
Credentials provider を外し、Auth.js built-in LINE provider に差し替える。middleware と JWT callback の形を整え、Phase 3 以降の UI 変更を安全に進められる土台を作る。**この phase の終わりで login 導線は壊れたままでよい** (Phase 3 の `/self-identify` と `/auth/signin` を作るまで連続性はない)。Phase 2-4 はユーザー可視ではなく、Phase 5 までまとめて動作確認する前提。

### 実装タスク

1. `apps/web/src/auth.config.ts`:
   ```ts
   import type { NextAuthConfig } from 'next-auth'
   import Line from 'next-auth/providers/line'

   export const authConfig = {
     providers: [
       Line({
         clientId: process.env.AUTH_LINE_ID,
         clientSecret: process.env.AUTH_LINE_SECRET,
       }),
     ],
     session: { strategy: 'jwt' },
     pages: {
       signIn: '/auth/signin',
       error: '/auth/signin',
     },
     callbacks: {
       authorized({ auth }) { return !!auth },
       async jwt({ token, user, account, trigger, session }) {
         // 初回 sign-in: user.id = profile.sub = LINE user ID
         if (user && account?.provider === 'line') {
           token.lineUserId = user.id  // string (profile.sub)
           // id/role/lineLinkedAt/lineLinkedMethod は signIn callback で DB から
           // 引いて token に埋め込むため、ここでは provider 由来の LINE user ID
           // だけ保存する。DB lookup は auth.ts 側で signIn callback に隔離。
         }
         // session.update() 経路: account switch 完了時、unlinkLine 実行時など
         if (trigger === 'update' && session && typeof session === 'object') {
           type Patch = {
             lineUserId?: string | null
             lineLinkedAt?: string | null
             lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | null
           }
           const s = session as Patch & { user?: Patch }
           const patch: Patch = s.user ?? s
           if (typeof patch.lineUserId === 'string' || patch.lineUserId === null) {
             token.lineUserId = patch.lineUserId
           }
           // lineLinkedAt/Method も同様に上書き
         }
         return token
       },
       async session({ session, token }) {
         if (session.user) {
           session.user.id = (token.id as string) ?? (token.sub as string)
           session.user.role = token.role as 'admin' | 'vice_admin' | 'member'
           session.user.lineUserId = (token.lineUserId as string | null | undefined) ?? null
           session.user.lineLinkedAt = (token.lineLinkedAt as string | null | undefined) ?? null
           session.user.lineLinkedMethod = (token.lineLinkedMethod as 'self_identify' | 'admin_link' | 'account_switch' | null | undefined) ?? null
         }
         return session
       },
     },
   } satisfies NextAuthConfig
   ```
   - **`mustChangePassword` 関連コードを全削除**

2. `apps/web/src/auth.ts`:
   ```ts
   import NextAuth from 'next-auth'
   import { eq } from 'drizzle-orm'
   import { authConfig } from './auth.config'
   import { db } from '@/lib/db'
   import { users } from '@kagetra/shared/schema'
   import { nodeJwtCallback } from '@/lib/node-jwt-callback'

   const baseCallbacks = authConfig.callbacks ?? {}
   const baseJwt = baseCallbacks.jwt

   export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
     ...authConfig,
     callbacks: {
       ...baseCallbacks,
       async signIn({ user, account }) {
         // LINE login: deactivated 会員の署名入りセッション発行を拒否
         if (account?.provider !== 'line') return true
         const lineUserId = user.id
         if (!lineUserId) return false
         const existing = await db.query.users.findFirst({
           where: eq(users.lineUserId, lineUserId),
           columns: { id: true, deactivatedAt: true, isInvited: true },
         })
         if (existing?.deactivatedAt) return false
         // まだ未紐付け (existing なし) の場合はログイン許可 → /self-identify で紐付け
         return true
       },
       async jwt(params) {
         // 初回 sign-in の場合、DB から現行 user レコードを引いて
         // id/role/grade/lineUserId/lineLinkedAt/lineLinkedMethod を token に埋め込み。
         // 未紐付けの場合 (LINE user ID が DB にない) は id=null のままで、middleware が
         // /self-identify へ誘導。
         if (!baseJwt) return params.token
         return nodeJwtCallback(
           params as Parameters<typeof nodeJwtCallback>[0],
           baseJwt as Parameters<typeof nodeJwtCallback>[1],
         )
       },
     },
   })
   ```

3. `apps/web/src/lib/node-jwt-callback.ts`: 以下のロジックに書き換え:
   - 初回 sign-in (`user !== undefined`) の場合、DB から users テーブルを `lineUserId = token.lineUserId` で引き、`id / role / name / lineLinkedAt / lineLinkedMethod` を token にセット
   - token.lineUserId が存在するが DB に対応 row がなければ `id = null` のまま返す (middleware が /self-identify へ)
   - 毎リクエスト時の deactivation チェックは従来通り残す (ただし `lineUserId` で lookup に変更)
   - **self-heal ロジック (lineUserId を DB から復元) は削除** (LINE provider が自動発行するため不要)
   - エクスポート signature は従来通り `(params, baseJwt)` → `Promise<JWT>`

4. `apps/web/src/next-auth.d.ts`:
   - `mustChangePassword` フィールドを全箇所 (Session, User, JWT) から削除
   - `lineUserId: string | null` は維持
   - `lineLinkedAt: string | null` と `lineLinkedMethod: 'self_identify' | 'admin_link' | 'account_switch' | null` を Session.user / User / JWT に追加

5. `apps/web/src/middleware.ts`:
   ```ts
   import NextAuth from 'next-auth'
   import { NextResponse } from 'next/server'
   import { authConfig } from './auth.config'

   const { auth } = NextAuth(authConfig)

   const PUBLIC_PATHS = ['/auth/signin', '/auth/error']
   const SELF_IDENTIFY_PATHS = ['/self-identify', '/api/self-identify']

   function startsWithAny(pathname: string, prefixes: string[]): boolean {
     return prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))
   }

   export default auth((req) => {
     const { nextUrl } = req
     const session = req.auth
     const pathname = nextUrl.pathname

     // Unauthenticated → /auth/signin
     if (!session) {
       if (startsWithAny(pathname, PUBLIC_PATHS)) return NextResponse.next()
       const url = nextUrl.clone()
       url.pathname = '/auth/signin'
       return NextResponse.redirect(url)
     }

     // Authenticated but not yet self-identified → /self-identify
     if (!session.user?.id && !startsWithAny(pathname, SELF_IDENTIFY_PATHS) && !startsWithAny(pathname, PUBLIC_PATHS)) {
       const url = nextUrl.clone()
       url.pathname = '/self-identify'
       return NextResponse.redirect(url)
     }

     // Authenticated user visiting /auth/signin → dashboard
     if (startsWithAny(pathname, PUBLIC_PATHS)) {
       const url = nextUrl.clone()
       url.pathname = '/'
       return NextResponse.redirect(url)
     }

     return NextResponse.next()
   })

   export const config = {
     matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
   }
   ```
   - **`mustChangePassword` 分岐全除去**
   - **`/login` / `/change-password` への参照全除去**
   - **未紐付け判定は `session.user?.id` が存在するか** (node-jwt-callback 側で、LINE user ID が DB に登録済みなら id をセット、未登録なら null のまま)

6. `.env.example`:
   - `AUTH_LINE_ID=` (Auth.js 経由の LINE login 用)
   - `AUTH_LINE_SECRET=` を新規追加
   - 既存 `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` / `LINE_LOGIN_CALLBACK_URL` は **維持** (account switch 用)
   - コメント明記: "Auth.js LINE provider は `AUTH_LINE_ID/SECRET` を使う。`LINE_LOGIN_*` は /settings/line-link の account switch 専用"

7. `apps/web/playwright.config.ts` の `webServer.env` に `AUTH_LINE_ID` / `AUTH_LINE_SECRET` のテスト用ダミー値を足す

### 検証チェックリスト (Phase 2)

- [ ] `pnpm -r check-types` PASS
- [ ] `pnpm -r lint` PASS
- [ ] Vitest は一時的に **削除 (Phase 6 で再建)**：この時点では login/change-password/callback 関連のテストが軒並み壊れる。**Phase 6 のクリーンアップ前提で、Phase 2 終了時点でテストが落ちるのは許容**。代わりに「`grep -r mustChangePassword apps/web/src` が **auth/login 関連以外で** 0 件」を確認
- [ ] dev server 起動時にコンパイルエラーが出ない (`pnpm dev:web` で起動 → 500 なくルートに到達)

### Anti-pattern ガード (Phase 2)

- ❌ `next-auth/providers/credentials` の import を残さない (Phase 2 の時点で全除去。実装コードは Phase 6 で削除するが、**import だけは Phase 2 で外す**)
- ❌ `import bcrypt` を auth 関連コードに残さない (同上)
- ❌ middleware.ts で DB アクセス・fs アクセス・Node-only API を使わない (Edge 制約)
- ❌ `session.user.mustChangePassword` への参照を残さない → grep で 0 件確認
- ❌ Auth.js の `events.signIn` で拒否しようとしない → `signIn` callback を使う (events は block 不可)

---

## Phase 3: /self-identify フロー

### 目的
LINE login 直後に未紐付け会員の本人選択ができる UI + Server Action + middleware 連携を実装する。**この phase 完了後、LINE login → 自己申告 → dashboard のハッピーパスが動く**。

### 実装タスク

1. `apps/web/src/app/auth/signin/page.tsx` (新規):
   - シンプルな Server Component。`signIn('line', { redirectTo: '/' })` を呼ぶボタンだけ。
   - error クエリパラメータ (`?error=deactivated` / `?error=...`) を読んでメッセージ表示。
   - error メッセージのマッピング:
     - `deactivated`: 「退会済みの会員です。再入会を希望される方は管理者にご連絡ください。」
     - `Configuration`: 「LINE Login 設定が未完了です。」(Auth.js default error)
     - default: 「ログインに失敗しました。」

2. `apps/web/src/app/self-identify/page.tsx` (新規):
   - Server Component。`auth()` で session を取得し、`session.user.id` が既に存在する場合は `/` へ redirect (middleware でも弾くが二重防御)。
   - `token.lineUserId` を signed session 経由で取得 (session callback で expose していない場合は expose する)。実装では `session.user.lineUserId` に既に入っている前提。
   - DB から候補を select:
     ```ts
     const candidates = await db.query.users.findMany({
       where: and(
         isNull(users.lineUserId),
         eq(users.isInvited, true),
         isNull(users.deactivatedAt),
       ),
       columns: { id: true, name: true, grade: true, affiliation: true },
       orderBy: users.name, // 名前 50 音順
     })
     ```
   - candidates が 0 件なら「管理者にご連絡ください」メッセージを表示 (form 出さない)
   - candidates 表示: ラジオボタンで `<label>${name} ${grade ? `(${grade}級)` : ''} ${affiliation ? ` / ${affiliation}` : ''}</label>`
   - form は `<form action={claimMemberIdentity}>` に `userId` を hidden で載せる
   - フッターに「自分が一覧にいない場合は管理者にご連絡ください」

3. `apps/web/src/app/self-identify/actions.ts` (新規):
   ```ts
   'use server'
   import { redirect } from 'next/navigation'
   import { revalidatePath } from 'next/cache'
   import { and, eq, isNull } from 'drizzle-orm'
   import { z } from 'zod'
   import { auth, unstable_update } from '@/auth'
   import { db } from '@/lib/db'
   import { users } from '@kagetra/shared/schema'

   const inputSchema = z.object({ userId: z.string().min(1) })

   export async function claimMemberIdentity(formData: FormData) {
     const session = await auth()
     const lineUserId = session?.user?.lineUserId
     if (!lineUserId || !session) redirect('/auth/signin')

     const parsed = inputSchema.safeParse({ userId: formData.get('userId') })
     if (!parsed.success) throw new Error('invalid_input')

     // 1 クエリで conditional update (該当行がなければ何も起きない)
     const updated = await db
       .update(users)
       .set({
         lineUserId,
         lineLinkedAt: new Date(),
         lineLinkedMethod: 'self_identify',
         updatedAt: new Date(),
       })
       .where(
         and(
           eq(users.id, parsed.data.userId),
           isNull(users.lineUserId),
           eq(users.isInvited, true),
           isNull(users.deactivatedAt),
         ),
       )
       .returning({ id: users.id, name: users.name, role: users.role })

     if (updated.length === 0) {
       // 候補が変わっている (他者 claim 済み / 退会 / 未招待) — エラー表示
       redirect('/self-identify?error=unavailable')
     }

     try {
       await unstable_update({
         user: {
           lineLinkedAt: new Date().toISOString(),
           lineLinkedMethod: 'self_identify',
         },
       })
     } catch {
       // JWT 更新失敗時は nodeJwtCallback 次回 Node render で自己修復
     }

     revalidatePath('/')
     redirect('/')
   }
   ```
   - UNIQUE violation (`users.lineUserId` unique) が起きる race condition: 同じ LINE user ID が既に別 row に書かれている時。**本番でここまで並行する事態はまれ**だが、23505 を catch して `?error=duplicate` にリダイレクト

4. `apps/web/src/app/self-identify/actions.test.ts` (新規 Vitest):
   - 正常: 候補選択 → users.lineUserId が書き換わる + lineLinkedAt/Method 記録
   - 異常: 非招待会員 id → エラー (users 無変化)
   - 異常: deactivated 会員 id → エラー (無変化)
   - 異常: 既に LINE 紐付け済み会員 id → エラー (無変化)
   - 異常: FormData なし → throw
   - 異常: session なし → signIn redirect

5. `apps/web/src/app/self-identify/page.test.tsx` は作らない (Server Component の表示テストは E2E で賄う)

6. middleware.ts は Phase 2 で既に対応済みのためこの phase では触らない

### 検証チェックリスト (Phase 3)

- [ ] `pnpm -r check-types` PASS
- [ ] `pnpm --filter=@kagetra/web test -- self-identify` PASS (新規テスト 5 件)
- [ ] middleware で `/self-identify` は未紐付け session で到達可能、紐付け済み session で `/` にリダイレクト (手動確認 or E2E 遅延)
- [ ] `session.user.lineUserId` が null のケースで `/self-identify` に redirect されることを Playwright で 1 本書く (Phase 7 で統合)

### Anti-pattern ガード (Phase 3)

- ❌ `candidates` 取得時の where 節で `isInvited` を忘れない (未招待の guest account が一覧表示されるセキュリティバグ)
- ❌ conditional update の where 節を緩めない (3 条件すべて必須: isNull(lineUserId), isInvited, isNull(deactivatedAt))
- ❌ `users.id = userId` だけで update しない (他者権限チェックがない攻撃経路になる)
- ❌ redirect 後に return しないパスを作らない (`redirect()` は throw だが TypeScript の narrowing で意識的に)

---

## Phase 4: /settings/line-link リファクタ (account switch 用途)

### 目的
PR #4 で作った `/settings/line-link` を「初回必須リンク」から「別 LINE アカウントへの切替」機能へ文言・動作変更。既存の state cookie / HMAC / zod 検証は流用、ただし書き込み時に `lineLinkedMethod='account_switch'` / `lineLinkedAt=now()` を記録する。

### 実装タスク

1. `apps/web/src/app/settings/line-link/page.tsx` 書き換え:
   - 「LINE 連携」タイトル → 「LINE アカウント切替」
   - 現 LINE user ID 末尾 6 桁だけ表示: `U****xxxxxx`
   - 「連携が必要」文言削除
   - `alreadyLinked` は必ず true の前提 (middleware で未紐付けは /self-identify へ行く)。未紐付けで直 URL で来た場合は `/self-identify` へ redirect
   - 「別の LINE アカウントに切り替える」ボタン
   - 切替完了時のエラー表示は既存のまま (`describeError`)

2. `apps/web/src/app/api/line-link/callback/route.ts` 更新:
   - UPDATE 時に `lineLinkedAt` / `lineLinkedMethod: 'account_switch'` も set
   - 「未紐付け → 初回紐付け」ケースは発生しない (middleware が /self-identify に行く) ので、既存 `existing` チェックは account switch の衝突検知専用として維持
   - `unstable_update` も `lineLinkedAt` / `lineLinkedMethod` を含めるよう更新

3. `apps/web/src/app/settings/line-link/actions.ts` 更新:
   - session があり、かつ既に lineUserId が set されている前提をアサート (未紐付けで到達しないはず)。到達した場合は `/self-identify` redirect
   - missing_env redirect 挙動はそのまま

4. `apps/web/src/app/api/line-link/callback/route.test.ts` 更新:
   - 正常系: 既存 user が別 LINE に切替 → `lineLinkedMethod='account_switch'` 確認
   - conflict 系: 他会員が既に使っている LINE → error=conflict (既存テスト流用)

### 検証チェックリスト (Phase 4)

- [ ] `pnpm --filter=@kagetra/web test -- line-link/callback` PASS
- [ ] 手動: dev server で `/settings/line-link` 画面確認 (LINE アカウント切替 UI)
- [ ] `line_linked_method` 書き込みが `'account_switch'` リテラルで DB に反映される (psql で確認 or テストで assert)

### Anti-pattern ガード (Phase 4)

- ❌ UI に「LINE 連携が必須」文言を残さない (残すと self-identify との意味重複で混乱)
- ❌ 未紐付け state で到達できる余地を残さない → 必ず middleware + action 両方で guard
- ❌ `LINE_OAUTH_TEST_MODE` env は account switch 用途に限定し、primary auth の LINE login テストで使わない (primary は直接 JWT 注入)

---

## Phase 5: Admin 監査 UI

### 目的
admin が誰が誰を claim したか把握できる画面と、誤 claim 解除ボタンを提供する。

### 実装タスク

1. `apps/web/src/app/(app)/admin/members/page.tsx` 更新:
   - テーブルに 2 列追加: 「LINE 紐付け日時」(フォーマット `YYYY-MM-DD HH:mm`)、「方法」(日本語ラベル: 自己申告 / 管理者 / 切替)
   - 並び順セレクタ: 既存 (名前昇順?) + 「LINE 紐付け日時 降順」オプション。default は変えない (破壊的変更回避)
   - `lineLinkedAt NULL` の行は 「未紐付け」表示

2. `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` に `unlinkLine` 追加:
   ```ts
   const unlinkInputSchema = z.object({ userId: z.string().min(1) })

   export async function unlinkLine(formData: FormData) {
     const session = await auth()
     if (session?.user?.role !== 'admin') throw new Error('forbidden')

     const parsed = unlinkInputSchema.safeParse({ userId: formData.get('userId') })
     if (!parsed.success) throw new Error('invalid_input')

     await db
       .update(users)
       .set({
         lineUserId: null,
         lineLinkedAt: null,
         lineLinkedMethod: null,
         updatedAt: new Date(),
       })
       .where(eq(users.id, parsed.data.userId))

     revalidatePath(`/admin/members/${parsed.data.userId}/edit`)
     revalidatePath('/admin/members')
   }
   ```

3. `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.tsx` (または同ディレクトリ UI ファイル) に紐付け解除ボタンを追加:
   - 現 LINE 紐付け状態の表示 (日時 / 方法)
   - 「LINE 紐付けを解除」ボタン → `unlinkLine` action (confirm ダイアログ)
   - `unlinkLine` 成功後、当該会員は次回 LINE login で `/self-identify` から再選択可能

4. `apps/web/src/app/(app)/admin/members/[id]/edit/actions.test.ts` に `unlinkLine` のテストを追加:
   - 正常: admin が実行 → 3 列が null に
   - 異常: member role が呼ぶ → forbidden
   - 異常: 存在しない userId → update 0 行 (無害)

### 検証チェックリスト (Phase 5)

- [ ] `pnpm --filter=@kagetra/web test -- members/.*edit` PASS
- [ ] 手動: admin で `/admin/members` を開いて新 2 列表示
- [ ] 手動: `/admin/members/<id>/edit` で「LINE 紐付け解除」ボタン表示 (member role では非表示)

### Anti-pattern ガード (Phase 5)

- ❌ admin role チェックをクライアント side で済ませない → 必ず Server Action 内で確認
- ❌ `/admin/members` へ新列を追加する際、既存並び順 default を変えない

---

## Phase 6: Credentials 関連コード除去 + テスト整備

### 目的
Phase 2-5 で未使用になった Credentials 系のコード・ファイル・依存を全削除し、テストを全面的に回復させる。

### 実装タスク

1. ディレクトリ削除:
   - `apps/web/src/app/login/` (page.tsx, actions.ts, actions.test.ts)
   - `apps/web/src/app/change-password/` (page.tsx, actions.ts, actions.test.ts, constants.ts)

2. ファイル削除:
   - `apps/web/src/lib/credentials-authorize.ts`

3. `apps/web/package.json`:
   - `"bcrypt"` 依存削除 (`dependencies`)
   - `"@types/bcrypt"` 削除 (`devDependencies`)
   - `pnpm install` で pnpm-lock.yaml 更新

4. `apps/web/src/test-utils/auth-mock.ts` (71 行):
   - `buildMockSession` から `mustChangePassword` フィールド削除
   - その他の `mustChangePassword` 参照除去
   - `lineLinkedAt` / `lineLinkedMethod` をデフォルトに追加 (未紐付けテスト用に null デフォルト)

5. `apps/web/src/test-utils/seed.ts`:
   - `createUser` / `createAdmin` のデフォルトから `mustChangePassword` / `passwordHash` 除去
   - `lineUserId` のデフォルトは **`null`** に変更 (従来 `Utest-...` 自動採番だったが、新 flow では lineUserId=null なら middleware が /self-identify に出す想定。明示的にセットしたいテストだけ override する方針)

6. `apps/web/src/test-utils/playwright-auth.ts`:
   - `IssueOptions` から `mustChangePassword` 削除
   - `encode` の token payload から `mustChangePassword` 削除
   - `lineLinkedAt` / `lineLinkedMethod` を追加 (Optional)
   - `seedMemberSession` / `seedAdminSession` の引数から mustChangePassword を外し、createUser のデフォルト変更に追従

7. E2E テスト削除・書き換え:
   - `apps/web/e2e/login-flow.spec.ts` **削除**
   - `apps/web/e2e/line-link-flow.spec.ts` を **account switch 専用に書き換え**:
     - beforeEach で lineUserId 有りの user を seed
     - /settings/line-link に行って切替フロー実行 (LINE_OAUTH_TEST_MODE 経路で)
     - 切替後の lineUserId / lineLinkedMethod='account_switch' を DB で確認

8. Vitest: 削除されるテストファイル
   - `apps/web/src/app/login/actions.test.ts` (dir 削除で自動消滅)
   - `apps/web/src/app/change-password/actions.test.ts` (dir 削除で自動消滅)

9. `apps/web/src/app/api/line-link/callback/route.test.ts`: Phase 4 で更新済み。再度 PASS 確認

### 検証チェックリスト (Phase 6)

- [ ] `pnpm -r check-types` PASS
- [ ] `pnpm -r lint` PASS
- [ ] `pnpm --filter=@kagetra/web test` 全 PASS (想定: 新 self-identify 5件 + 既存 admin/line-link + 周辺 = 40〜45件)
- [ ] `grep -r "bcrypt" apps/web/src packages/shared/src` が **0 件**
- [ ] `grep -r "mustChangePassword" apps/web/src packages/shared/src` が **0 件**
- [ ] `grep -r "credentials-authorize" apps/web/src` が **0 件**
- [ ] `grep -rE "['\"]\/login(['\"]|\?|\/)" apps/web/src` が **0 件** (文字列リテラルとしての /login 参照)
- [ ] `pnpm install` 後 `pnpm-lock.yaml` 差分に bcrypt / @types/bcrypt の削除が見える
- [ ] `apps/web/package.json` の dependencies に bcrypt 系が残らない

### Anti-pattern ガード (Phase 6)

- ❌ bcrypt を隠しパッケージで残さない (transitive 以外は全部クリーンに)
- ❌ `apps/web/src/app/(unused)/` 等のダミーディレクトリに退避して済ませない (完全削除)
- ❌ E2E で Credentials を testing provider として残さない (Auth.js 推奨パターンだが、ここでは採用しない方針を維持)

---

## Phase 7: E2E + worklog + PR

### 目的
ハッピーパス + 主要エッジケースの E2E を新規作成し、worklog を更新して PR を作る。

### 実装タスク

1. `apps/web/e2e/self-identify-flow.spec.ts` (新規):
   - **ケース A: 新規 LINE user → self-identify → dashboard**
     - seed: `isInvited=true, lineUserId=null` な user 1 件 (alice)
     - `issueJwtSession` で `lineUserId='U-fake-new-user'`, `id=null` の session 注入 (node-jwt-callback が id=null を返すケースをエミュレート)
     - `/` アクセス → `/self-identify` redirect
     - alice を選択 → form submit
     - `/` に着地、alice の DB row の lineUserId が `U-fake-new-user`、lineLinkedMethod='self_identify'
   - **ケース B: 既紐付け user → 直接 dashboard**
     - seed: alice に既に lineUserId 紐付け済み
     - `issueJwtSession` で alice の通常 session 注入
     - `/` アクセス → 200
   - **ケース C: admin が誤 claim を解除、別 member が再 claim**
     - seed: alice に lineUserId X 紐付け済み、bob 未紐付け
     - admin session で `/admin/members/<alice>/edit` → 「LINE 紐付け解除」クリック
     - alice の DB row lineUserId=null に戻る
     - bob の session (lineUserId=X') で `/` → `/self-identify` → alice または bob 選択? (ここは X' の new user がどちらの候補を claim するかのテスト)
     - **注**: このケースは意味が複雑なので「admin 解除後、後続 LINE login user が /self-identify に到達できる」だけ確認に留める
   - **ケース D: 未招待会員は候補に出ない**
     - seed: alice (invited) + charlie (isInvited=false)
     - new user session で `/self-identify` → 候補リストに charlie 無し、alice のみ
   - **ケース E: deactivated 会員は候補に出ない**
     - 同様に deactivatedAt あり の dave が候補外

2. `apps/web/e2e/line-link-flow.spec.ts` は Phase 6 で account switch 用に書き換え済み。内容再確認:
   - 既紐付け user が `/settings/line-link` から別 LINE へ切替 → `lineLinkedMethod='account_switch'`
   - 別会員が使っている LINE を選ぶと conflict エラー

3. `apps/web/e2e/permission-control.spec.ts` 等の既存 E2E が `mustChangePassword` を参照していたら除去 (Phase 6 で大半対応)

4. `docs/worklog.md` に追記:
   - セクション: `## 2026-04-XX (date TBD) セッション（Phase 1-5 PR-D: LINE login 差し戻し）`
   - 差し戻し理由、新 self-identify フロー、admin 監査、PR #5 (仮) URL

5. PR 作成:
   - ブランチ: `feat/phase-1-5-auth-pivot-line-login`
   - タイトル: `refactor(auth): pivot to LINE Login + self-identify flow (PR-D of Phase 1-5)`
   - 本文テンプレ: Summary / Schema changes / Auth flow changes / Admin audit / Test plan / Follow-ups / Breaking changes (Credentials 完全除去)

### 検証チェックリスト (Phase 7)

- [ ] `pnpm -r check-types` PASS
- [ ] `pnpm -r lint` PASS
- [ ] `pnpm --filter=@kagetra/web test` 全 PASS
- [ ] `pnpm --filter=@kagetra/web exec playwright test` 全 PASS (ケース A-E + account switch + 既存 permission/grade)
- [ ] CI green
- [ ] PR description に breaking changes (bcrypt 除去 / `/login` 削除 / mustChangePassword 除去 / env 変数変更) を明記

### Anti-pattern ガード (Phase 7)

- ❌ worklog に古い情報 (Credentials 採用) をそのまま残さない → 新方針と経緯を明記
- ❌ PR を draft のまま放置しない → Codex レビュー依頼まで完走
- ❌ Breaking changes の記述漏れ (本番適用時に `.env.local` 更新 + DB migration + 会員への案内文が必要)

---

## Final Phase: Verification

Phase 7 終了後、以下を逐一チェック:

### 全体 anti-pattern grep
```
grep -rn "bcrypt" apps/ packages/shared/src/ --include="*.ts" --include="*.tsx"
grep -rn "mustChangePassword" apps/ packages/shared/src/
grep -rn "credentials-authorize" apps/
grep -rn "passwordHash\|password_hash" apps/ packages/shared/src/
grep -rnE "['\"]\/login([\"'?\/])" apps/web/src/
```
いずれも **0 件** (ただし memory / docs / worklog に履歴として残るのは許容)。

### 動作確認 (手動)
- [ ] dev server 起動 → ルート `/` → `/auth/signin` に redirect
- [ ] LINE login 実行 → DB に lineUserId がない状態 → `/self-identify` に着地 → 候補表示
- [ ] 候補選択 → `/` に着地、session.user.lineUserId 取得成功
- [ ] 再度 logout → login → 今度は紐付け済みなので直接 `/` へ
- [ ] admin で `/admin/members` を開く → 「LINE 紐付け日時」列が表示され、今 claim した member の日時が見える
- [ ] admin で誰かを解除 → 該当 member の次回 LINE login で /self-identify へ戻る
- [ ] `/settings/line-link` から別 LINE へ切替 → `line_linked_method='account_switch'` 記録

### memory / docs の整合性
- [ ] `.claude/memory/project_kagetra_new_design.md` #3 の記述が最新方針と一致
- [ ] `docs/phase-1-5-migration-plan.md` §3.4 から bcrypt / pppppppp が消えている
- [ ] `docs/worklog.md` に本 PR の記録あり

### 使用フローの整合性
- `self_identify` / `admin_link` / `account_switch` の 3 値それぞれが実際の UI 経路で書かれることを確認:
  - `self_identify`: `/self-identify` action
  - `admin_link`: admin が将来的に「この user に LINE X を手動紐付け」機能を追加する場合のために予約 (本 PR ではコード側で使わない。enum 値だけ用意)。README / memory にその旨記載
  - `account_switch`: `/api/line-link/callback` (account switch 成立時)

### データ移行整合
- `docs/phase-1-5-migration-plan.md` §3.4 migrate-users.ts 仕様で `lineLinkedAt = NULL, lineLinkedMethod = NULL` を初期値とする旨が明記されているか確認

---

## Phase 実行順序とブランチ運用

- **ブランチ**: `feat/phase-1-5-auth-pivot-line-login` を main から切る
- **各 phase 終了時**: verification + anti-pattern grep + lint/typecheck/test を実行してから次 phase に進む
- **commit 粒度**: phase 単位で 1-2 commit を推奨。phase 途中での commit は自由。ただし、push は phase 完了時点で行う (壊れたままの push を避ける)
- **Phase 2 は途中で test が壊れることを許容**。この時点で stash せずに Phase 3 → 5 → 6 → 7 と進める。Phase 6 のクリーンアップで回復する
- **PR は Phase 7 の末尾でのみ作成**。途中で draft PR を作ってもよいが、Codex レビュー依頼は全 phase 完了後

## リスクと緩和策

| リスク | 緩和策 |
|---|---|
| Phase 2 で test が全滅し、戻れなくなる | phase 単位で commit、git reset で戻れる。worktree を使えばさらに安全 |
| Auth.js LINE provider の `profile.sub` 仕様が想定と違う | Phase 2 で dev server を起動し、LINE login 実行 → `console.log(profile)` で実データを確認してから先に進む |
| middleware の self-identify redirect が無限ループ | `SELF_IDENTIFY_PATHS` を必ず除外。テストで to(`/self-identify`) が複数回 redirect しないことを E2E で確認 |
| `unlinkLine` 後の member が再 login した際、/self-identify で候補に自分が出ない | candidate 条件は `lineUserId IS NULL` で、unlink 後は NULL に戻るので OK。確認は E2E ケース C |
| PR-C (データ移行) が古い前提 (bcrypt seed) で計画されていることの置き去り | Phase 1 で migration-plan.md を更新する。Phase 7 で再確認 |

## Phase 実行時の orchestrator メモ

- 各 phase を実行するときは `/claude-mem:do` の orchestrator 規約に従い、Implementation / Verification / Anti-pattern / Commit の subagent を順次投入する
- **Commit subagent は Verification + Anti-pattern が全 PASS した時のみ起動する** (本プランの verification checklist を文字通り checklist として使う)
- Phase 間で context を引き継ぐ場合は、この plan ファイルへの参照を渡せば十分
- 各 phase で生じた設計判断の変更は、この plan の当該 phase 末尾に追記してから次 phase に進む
