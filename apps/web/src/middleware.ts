import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Minimal middleware — no auth processing here.
 *
 * Auth.js v5 database sessions require pg/crypto which is unavailable in the
 * Edge runtime. Using `auth as middleware` from '@/auth' (which carries the
 * DrizzleAdapter) would emit JWTSessionError on every request, potentially
 * clearing session cookies.
 *
 * Instead, each page/route calls `auth()` from '@/auth' directly, which runs
 * in Node.js and can perform the DB session lookup via the adapter.
 *
 * The Auth.js OAuth endpoints (/api/auth/…) are excluded from this matcher
 * and continue to work normally.
 *
 * TODO: Switch to `experimental.nodeMiddleware: true` + `export const runtime
 * = 'nodejs'` in next.config.ts once that API is stable, then restore
 * `export { auth as middleware } from '@/auth'` for automatic session refresh.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
