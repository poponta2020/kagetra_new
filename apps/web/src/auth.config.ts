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
      }
      // Allow session.update({ mustChangePassword: false }) post password change.
      if (trigger === 'update' && session && typeof session === 'object') {
        const patch = session as { mustChangePassword?: boolean }
        if (typeof patch.mustChangePassword === 'boolean') {
          token.mustChangePassword = patch.mustChangePassword
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string)
        session.user.role = token.role as 'admin' | 'vice_admin' | 'member'
        session.user.mustChangePassword = Boolean(token.mustChangePassword)
      }
      return session
    },
  },
} satisfies NextAuthConfig
