import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from './auth.config'

/**
 * Edge-safe middleware using JWT sessions.
 *
 * Auth.js v5 with JWT strategy reads the session token from cookies without
 * needing DB access, so this runs safely in the Edge runtime. The Credentials
 * provider's `authorize` callback lives in `auth.ts` and is not referenced here.
 */
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default auth((req) => {
  const { nextUrl } = req
  const session = req.auth
  const pathname = nextUrl.pathname

  // Unauthenticated: only /login is reachable.
  if (!session) {
    if (isPublicPath(pathname)) return NextResponse.next()
    const url = nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authenticated but must change password: force /change-password.
  if (
    session.user?.mustChangePassword &&
    pathname !== '/change-password'
  ) {
    const url = nextUrl.clone()
    url.pathname = '/change-password'
    return NextResponse.redirect(url)
  }

  // Authenticated user visiting /login → redirect to dashboard root.
  if (isPublicPath(pathname)) {
    const url = nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
