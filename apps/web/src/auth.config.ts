import type { NextAuthConfig } from 'next-auth'
import Line from 'next-auth/providers/line'
import {
  isRolePreviewAllowed,
  parseUserRole,
  resolveEffectiveRole,
  selectableRoles,
} from '@/lib/role-preview'
import type { UserRole } from '@/lib/role-preview'

/**
 * Edge-safe auth config: session strategy, pages, providers, and the jwt/session
 * callbacks. These run in both the Edge middleware and Node server contexts, so
 * they must not touch the DB or Node-only modules.
 *
 * LINE provider (primary auth) is defined here — it is Edge-safe per Auth.js v5
 * (https://authjs.dev/getting-started/providers/line). The Node-only DB revalidation
 * (deactivation check + LINE user ID → internal user id resolution) is added in
 * auth.ts via a wrapper over this jwt callback.
 *
 * `line_link_method` enum values (self_identify / admin_link / account_switch /
 * invite_link) are written by Server Actions (not here).
 */
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
    authorized({ auth }) {
      // Gate pages on "has a session at all". Per-route rules (lineUserId bind,
      // role checks) are enforced in middleware.ts, which can redirect to
      // specific destinations. Returning true here would bypass Auth.js's default
      // unauthenticated redirect, so we still require `auth` to be present.
      return !!auth
    },
    async jwt({ token, user, account, trigger, session }) {
      // First sign-in via LINE: account.providerAccountId = profile.sub (the
      // stable LINE user ID). Under Auth.js v5 with the JWT strategy and no DB
      // adapter, `user.id` is a random UUID minted per sign-in, so it cannot be
      // used as the LINE identifier. We stash providerAccountId as
      // token.lineUserId; auth.ts wrapper then resolves it to our internal
      // users.id on the Node side.
      if (user && account?.provider === 'line' && account.providerAccountId) {
        token.lineUserId = account.providerAccountId
        // role-preview-switch: 再ログインでプレビューは必ず解除する。
        // 新規サインインの token は本来まっさらだが、明示的に落として
        // 「ログアウト → 再ログインで本物のロールへ戻る」を保証する。
        token.viewAsRole = null
      }
      // session.update({...}) path: account switch completion, admin unlink, etc.
      // Auth.js passes the update payload through as `session`; callers may pass
      // either a flat `{ ...patch }` or `{ user: { ...patch } }`.
      if (trigger === 'update' && session && typeof session === 'object') {
        // NOTE: このパッチ許可リストに載っていないフィールドは
        // unstable_update() に渡しても**黙って捨てられる**。新しいクレームを
        // 足すときは必ずここへ明示的に追加すること。
        type Patch = {
          lineUserId?: string | null
          lineLinkedAt?: string | null
          lineLinkedMethod?:
            | 'self_identify'
            | 'admin_link'
            | 'account_switch'
            | 'invite_link'
            | null
          viewAsRole?: UserRole | null
        }
        const s = session as Patch & { user?: Patch }
        const patch: Patch = s.user ?? s
        if (typeof patch.lineUserId === 'string' || patch.lineUserId === null) {
          token.lineUserId = patch.lineUserId
        }
        if (typeof patch.lineLinkedAt === 'string' || patch.lineLinkedAt === null) {
          token.lineLinkedAt = patch.lineLinkedAt
        }
        if (
          patch.lineLinkedMethod === null ||
          patch.lineLinkedMethod === 'self_identify' ||
          patch.lineLinkedMethod === 'admin_link' ||
          patch.lineLinkedMethod === 'account_switch' ||
          patch.lineLinkedMethod === 'invite_link'
        ) {
          token.lineLinkedMethod = patch.lineLinkedMethod
        }
        // role-preview-switch: ⚠️ この update 経路は Server Action 専用ではない。
        // Auth.js の `POST /api/auth/session`（`useSession().update()` と同じ
        // エンドポイント）は、認証済みクライアントが送った任意のペイロードを
        // そのままここへ渡す。したがって切替 Server Action 側の許可リスト判定
        // だけでは迂回できてしまう（fail-closed の AC-1 / AC-2 / AC-10 が破れる）。
        // JWT を書き換えるこの一点でも許可リストと本物のロールを検査する。
        //
        // `null`（プレビュー解除）だけは無条件に受け付ける。運用中に env から
        // de-list されたユーザーの締め出しを防ぐためで、実効ロールは下がる方向
        // にしか動かないので権限が広がることはない。
        //
        // `process.env` はこの update 分岐の中でだけ読む。middleware（Edge）の
        // `auth()` は trigger='update' を立てないためここには入らず、実際に
        // 到達するのは `unstable_update`（Server Action）と `/api/auth/session`
        // の route handler ＝いずれも Node ランタイム。
        if (patch.viewAsRole === null) {
          token.viewAsRole = null
        } else if (patch.viewAsRole !== undefined) {
          const requested = parseUserRole(patch.viewAsRole)
          // token.sub は LINE の profile.sub で users.id とは別名前空間なので
          // 使わない（session コールバックの同旨コメント参照）。
          const allowed = isRolePreviewAllowed(
            token.id as string | undefined,
            process.env.ROLE_PREVIEW_USER_IDS,
          )
          const realRole = parseUserRole(token.role)
          // `selectableRoles` が「本物のロール以下」と「ゲストは admin 限定」
          // （requirements R1）の両方を内包するので、ここで guest を個別に
          // 弾く必要はない。副管理者・一般会員が viewAsRole='guest' を直接
          // 送ってもこの includes が false になって拒否される（AC-25）。
          if (
            requested &&
            allowed &&
            realRole &&
            selectableRoles(realRole).includes(requested)
          ) {
            token.viewAsRole = requested
          }
          // 上記を満たさない場合は token を一切変えない（AC-10 / AC-11 の
          // 「拒否時は状態不変」）。
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        // IMPORTANT: do not fall back to token.sub here. For LINE logins,
        // token.sub is profile.sub (the LINE user ID), a different namespace
        // from our internal users.id. Middleware checks `!session.user?.id`
        // to decide whether to route to /self-identify; falling back to
        // token.sub would paper over the unbound state and skip that gate.
        session.user.id = (token.id as string | undefined) ?? ''
        // role-preview-switch の唯一の切替点。`token.role` は常に本物の
        // ロールで、プレビュー値で上書きされることはない。実効ロールは
        // ここでだけ導出され、`viewAsRole` は本物のロール以下へ丸められる
        // (昇格不能)。`session.user.role` を読む既存 41 ファイル・162 箇所は
        // 無変更のまま実効ロールに追従し、UI の出し分けと Server Action /
        // route handler の認可が同時に切り替わる。
        // プレビューの開始・終了の認可には `realRole` **だけ**を使うこと。
        const realRole = token.role as UserRole
        session.user.realRole = realRole
        session.user.role = resolveEffectiveRole(realRole, token.viewAsRole) as UserRole
        session.user.lineUserId = (token.lineUserId as string | null | undefined) ?? null
        session.user.lineLinkedAt = (token.lineLinkedAt as string | null | undefined) ?? null
        session.user.lineLinkedMethod =
          (token.lineLinkedMethod as
            | 'self_identify'
            | 'admin_link'
            | 'account_switch'
            | 'invite_link'
            | null
            | undefined) ?? null
      }
      return session
    },
  },
} satisfies NextAuthConfig
