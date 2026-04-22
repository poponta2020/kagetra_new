import type { JWT } from 'next-auth/jwt'
import type { User, Session, Account } from 'next-auth'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

type JwtParams = {
  token: JWT
  user?: User
  account?: Account | null
  trigger?: 'signIn' | 'signUp' | 'update'
  session?: Session | null
  isNewUser?: boolean
}

type BaseJwt = (params: JwtParams) => Promise<JWT> | JWT

/**
 * Node-only jwt callback wrapper. Two responsibilities:
 *
 * 1. Resolve `token.lineUserId` → our internal users row whenever `token.id`
 *    is not yet set. Runs on first sign-in (baseJwt has just stashed the LINE
 *    profile.sub as `token.lineUserId`) AND on every subsequent request where
 *    `token.id` is still unset but `token.lineUserId` is present — i.e. after
 *    `/self-identify` finishes, or after an account-switch callback updates
 *    the DB without passing id through `unstable_update`. If no row matches,
 *    leave `token.id` undefined so middleware keeps redirecting to
 *    /self-identify.
 *
 * 2. On every subsequent call once `token.id` is set: recheck deactivatedAt;
 *    if the user was deactivated after login, return `null` so Auth.js
 *    invalidates the session cookie and middleware's unauthenticated branch
 *    fires on the next request.
 */
export async function nodeJwtCallback(
  params: JwtParams,
  baseJwt: BaseJwt,
): Promise<JWT | null> {
  // Let the base callback populate token.lineUserId + any update()-driven patches first.
  const token = await baseJwt(params)

  const lineUserId = token.lineUserId as string | null | undefined
  const id = token.id as string | undefined

  // Resolve lineUserId → internal users.id whenever id is still unbound.
  // This covers both the first-signin path and the post-self-identify path
  // (where unstable_update only rewrites link metadata, not id/role/name).
  if (!id && lineUserId) {
    const row = await db.query.users.findFirst({
      where: eq(users.lineUserId, lineUserId),
      columns: {
        id: true,
        name: true,
        role: true,
        lineLinkedAt: true,
        lineLinkedMethod: true,
        deactivatedAt: true,
      },
    })
    if (row && !row.deactivatedAt) {
      token.id = row.id
      token.name = row.name ?? undefined
      token.role = row.role
      token.lineLinkedAt = row.lineLinkedAt ? row.lineLinkedAt.toISOString() : null
      token.lineLinkedMethod = row.lineLinkedMethod
    }
    // If row is missing or deactivated, leave token.id undefined.
    // Middleware will route to /self-identify (for missing row); deactivated
    // users never reach here on first signin because signIn() in auth.ts
    // already returns a redirect string.
    return token
  }

  // Every-request path: if we previously resolved an id, revalidate it against
  // the DB. This catches admins who were deactivated mid-session.
  if (id) {
    const row = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, deactivatedAt: true },
    })
    if (!row || row.deactivatedAt) {
      // Returning null invalidates the Auth.js session cookie on next render,
      // so middleware's `!session` branch fires and redirects to /auth/signin.
      // A subsequent LINE re-login will be rejected at the signIn() callback
      // with `?error=deactivated`.
      return null
    }
  }

  return token
}
