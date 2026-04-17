import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'

// Edge-safe: authConfig has no DB adapter (no `pg` import).
// Route protection is handled per-page via auth() from '@/auth'.
// Middleware just propagates the session token so Next.js internals work.
const { auth } = NextAuth(authConfig)
export { auth as middleware }

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
