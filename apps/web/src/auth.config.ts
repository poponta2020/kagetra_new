import type { NextAuthConfig } from 'next-auth'
import Line from 'next-auth/providers/line'

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
 * `line_link_method` enum values (self_identify / admin_link / account_switch) are
 * written by Server Actions (not here).
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
      // First sign-in via LINE: user.id = profile.sub (the stable LINE user ID).
      // We stash it as token.lineUserId; auth.ts wrapper then resolves it to our
      // internal users.id on Node side.
      if (user && account?.provider === 'line') {
        token.lineUserId = user.id
      }
      // session.update({...}) path: account switch completion, admin unlink, etc.
      // Auth.js passes the update payload through as `session`; callers may pass
      // either a flat `{ ...patch }` or `{ user: { ...patch } }`.
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
        if (typeof patch.lineLinkedAt === 'string' || patch.lineLinkedAt === null) {
          token.lineLinkedAt = patch.lineLinkedAt
        }
        if (
          patch.lineLinkedMethod === null ||
          patch.lineLinkedMethod === 'self_identify' ||
          patch.lineLinkedMethod === 'admin_link' ||
          patch.lineLinkedMethod === 'account_switch'
        ) {
          token.lineLinkedMethod = patch.lineLinkedMethod
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string)
        session.user.role = token.role as 'admin' | 'vice_admin' | 'member'
        session.user.lineUserId = (token.lineUserId as string | null | undefined) ?? null
        session.user.lineLinkedAt = (token.lineLinkedAt as string | null | undefined) ?? null
        session.user.lineLinkedMethod =
          (token.lineLinkedMethod as 'self_identify' | 'admin_link' | 'account_switch' | null | undefined) ?? null
      }
      return session
    },
  },
} satisfies NextAuthConfig
