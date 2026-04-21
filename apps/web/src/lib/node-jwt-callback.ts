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
 * 1. On first sign-in (trigger=signIn, user && account): the token has
 *    `lineUserId = user.id` (the LINE profile.sub) from the base callback.
 *    Resolve that to our internal users row and populate id/role/name/
 *    lineLinkedAt/lineLinkedMethod on the token. If no row matches, leave
 *    `token.id` undefined — middleware reads that state and redirects to
 *    /self-identify so the user can claim an invited member row.
 *
 * 2. On every subsequent call (trigger=undefined or 'update'): if `token.id`
 *    is set, recheck deactivatedAt; if the user was deactivated after login,
 *    blank out the token so Auth.js treats the session as signed-out.
 */
export async function nodeJwtCallback(
  params: JwtParams,
  baseJwt: BaseJwt,
): Promise<JWT> {
  // Let the base callback populate token.lineUserId + any update()-driven patches first.
  const token = await baseJwt(params)

  const lineUserId = token.lineUserId as string | null | undefined

  // First sign-in path: baseJwt has just set lineUserId from user.id.
  if (params.trigger === 'signIn' && lineUserId) {
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
    // users never reach here because signIn() in auth.ts already returns false.
    return token
  }

  // Every-request path: if we previously resolved an id, revalidate it against
  // the DB. This catches admins who were deactivated mid-session.
  const id = token.id as string | undefined
  if (id) {
    const row = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, deactivatedAt: true },
    })
    if (!row || row.deactivatedAt) {
      // Blank the token: returning an empty-ish JWT leaves no usable claims,
      // so middleware / Server Components will treat as unauthenticated.
      return {} as JWT
    }
  }

  return token
}
