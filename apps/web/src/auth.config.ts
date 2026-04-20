import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe auth config: session strategy, pages, and the jwt/session
 * callbacks. These callbacks run in both the Edge middleware and Node
 * server contexts, so they must not touch the DB or Node-only modules.
 *
 * Providers are defined in `auth.ts` because the Credentials provider's
 * `authorize` callback needs DB access (via `pg` / `bcrypt`) which is not
 * available in the Edge runtime. Middleware consumes only the JWT payload.
 *
 * See: https://authjs.dev/guides/edge-compatibility
 */
export const authConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    authorized({ auth }) {
      // Let middleware handle redirects explicitly; always allow here.
      return !!auth
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = (user as { id?: string }).id ?? (token.sub as string)
        token.role = (user as { role?: 'admin' | 'vice_admin' | 'member' }).role
        token.mustChangePassword = Boolean(
          (user as { mustChangePassword?: boolean }).mustChangePassword,
        )
        // lineUserId: null on first login (pre-link), set after LINE OAuth
        // completes. Middleware uses this to enforce the link step without
        // hitting the DB on every request.
        token.lineUserId =
          (user as { lineUserId?: string | null }).lineUserId ?? null
      }
      // Allow session.update({ mustChangePassword | lineUserId }) post flow.
      // Auth.js passes the update payload through as `session`; callers may
      // pass either a flat `{ ...patch }` or `{ user: { ...patch } }`.
      if (trigger === 'update' && session && typeof session === 'object') {
        type Patch = {
          mustChangePassword?: boolean
          lineUserId?: string | null
        }
        const s = session as Patch & { user?: Patch }
        const patch: Patch = s.user ?? s
        if (typeof patch.mustChangePassword === 'boolean') {
          token.mustChangePassword = patch.mustChangePassword
        }
        if (
          typeof patch.lineUserId === 'string' ||
          patch.lineUserId === null
        ) {
          token.lineUserId = patch.lineUserId
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string)
        session.user.role = token.role as 'admin' | 'vice_admin' | 'member'
        session.user.mustChangePassword = Boolean(token.mustChangePassword)
        session.user.lineUserId =
          (token.lineUserId as string | null | undefined) ?? null
      }
      return session
    },
  },
} satisfies NextAuthConfig
