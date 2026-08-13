import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from './auth.config'
import { isGuestAllowedPath, isGuestRole } from './lib/guest-access'

/**
 * Edge-safe middleware using JWT sessions.
 *
 * Auth.js v5 with JWT strategy reads the session token from cookies without
 * needing DB access, so this runs in the Edge runtime.
 *
 * Per-user gating decisions read only JWT claims set by the Node-side jwt
 * callback in auth.ts:
 *   - token.id set    → user is fully bound to an invited member; allow through
 *   - token.id unset  → LINE login succeeded but no matching internal user row
 *                        yet; force /self-identify so the user can claim
 *   - no session      → force /auth/signin
 *   - token.role='guest' → allowlist gate (see lib/guest-access.ts)
 *
 * `/register/*` (invite-link self-registration) is a special category:
 *   - no session            → allow through (welcome + "LINEで登録" button)
 *   - session, id unset      → allow through (the deliberate exception to the
 *                              /self-identify force — the registrant fills the
 *                              name/grade form here after LINE OAuth)
 *   - session, id set (bound) → redirect to / (already a member, nothing to do)
 */
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/auth/signin', '/auth/error']
const SELF_IDENTIFY_PATHS = ['/self-identify']
const REGISTER_PATHS = ['/register']

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default auth((req) => {
  const { nextUrl } = req
  const session = req.auth
  const pathname = nextUrl.pathname
  const isRegister = startsWithAny(pathname, REGISTER_PATHS)

  // Unauthenticated: /auth/signin (+ /auth/error for LINE errors) and the
  // public /register/* welcome screen are reachable; everything else → signin.
  if (!session) {
    if (startsWithAny(pathname, PUBLIC_PATHS) || isRegister) return NextResponse.next()
    const url = nextUrl.clone()
    url.pathname = '/auth/signin'
    return NextResponse.redirect(url)
  }

  // Authenticated but no internal id yet → /self-identify (LINE user ID is set,
  // but the user hasn't claimed an invited member row). /register/* is exempt:
  // an invite-link registrant is unbound by design and fills the form there.
  if (
    !session.user?.id &&
    !startsWithAny(pathname, SELF_IDENTIFY_PATHS) &&
    !startsWithAny(pathname, PUBLIC_PATHS) &&
    !isRegister
  ) {
    const url = nextUrl.clone()
    url.pathname = '/self-identify'
    return NextResponse.redirect(url)
  }

  // Bound user (id set) visiting /auth/signin, or any bound user landing on
  // /register/* (registration already done) → dashboard. The `id` guard keeps
  // an unbound registrant on /register/* instead of bouncing them here.
  if (
    startsWithAny(pathname, PUBLIC_PATHS) ||
    (isRegister && !!session.user?.id)
  ) {
    const url = nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // guest-role: ゲストの許可リスト（fail-closed）。ここは**早期ゲート（UX）**で、
  // Edge が読む JWT の role は Node 側の jwt callback が DB から再同期するまで
  // stale になりうる（会員 → ゲストへ降格した直後など）。したがって本当の防御は
  // Node 側（route handler・ページ）の `isGuestRole(session.user.role)` 判定にも
  // 置いてある（二段構え。requirements §6）。
  //
  // API とページで応答を変える: `/api/` は 403 の JSON（リダイレクトを返すと
  // fetch/<img> 側が HTML を掴んで意味不明な失敗になる）、それ以外は /403 へ。
  if (isGuestRole(session.user?.role) && !isGuestAllowedPath(pathname)) {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const url = nextUrl.clone()
    url.pathname = '/403'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    // event-line-broadcast (r3 review blocker): LINE Webhook と公開
    // attachment / image 配信エンドポイントは未認証アクセスが前提
    // (LINE グループの非ログインゲスト含む)。middleware を通すと
    // /auth/signin にリダイレクトされて到達不能になる。
    // invite-register-redesign: /api/zip は /register/* 登録中の未紐付け
    // (id 未設定) ユーザーが叩くため、ここを通すと /self-identify へ
    // リダイレクトされ郵便番号→住所補完が失敗する。無認証・無鍵の
    // 公開 zipcloud プロキシなので matcher から除外する。
    // external-entrants-api: /api/external/** は他システム連携（match-tracker）
    // 用で、Auth.js セッションとは独立の静的 API キー認証（Authorization:
    // Bearer・fail-closed）。middleware を通すと /auth/signin へリダイレクト
    // されて到達不能になるため除外する。ガードはルート内の
    // verifyExternalApiKey が全部担う。この名前空間には外部連携ルート以外を
    // 作らないこと。
    '/((?!api/auth|api/webhook/line|api/line-broadcast|api/zip|api/external|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|apple-touch-icon.png|sw.js).*)',
  ],
}
