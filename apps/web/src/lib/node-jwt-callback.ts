import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import type { JWT } from 'next-auth/jwt'
import type { User, Session } from 'next-auth'

type JwtParams = {
  token: JWT
  user?: User
  trigger?: 'signIn' | 'signUp' | 'update' | string
  session?: Session | Record<string, unknown>
}

type BaseJwt = (p: JwtParams) => Promise<JWT | null> | JWT | null

/**
 * Node-only JWT callback that wraps the edge-safe base callback and adds
 * DB revalidation. Two jobs:
 *
 * 1. Catch user deactivation — a revoked account returns null here so the
 *    next Node render bounces to /login.
 * 2. Self-heal `lineUserId` — if the LINE-link callback's `unstable_update`
 *    failed (transient error, concurrent request), the JWT can stay stale
 *    with `lineUserId=null` even though the DB is linked. Edge middleware
 *    would then trap the user on /settings/line-link indefinitely. Pulling
 *    the current `lineUserId` from the same row we're already fetching for
 *    the deactivation check lets the JWT recover on the next Node render.
 *
 * Edge middleware uses only the base callback (via auth.config.ts) and is
 * kept DB-free.
 */
export async function nodeJwtCallback(
  params: JwtParams,
  baseCallback: BaseJwt,
): Promise<JWT | null> {
  const token = await baseCallback(params)
  if (!token) return null

  // Skip the DB check on the initial sign-in path (user is set then) —
  // authorizeCredentials already enforced deactivatedAt and provided the
  // authoritative lineUserId.
  if (params.user) return token

  const userId = (token.id ?? token.sub) as string | undefined
  if (!userId) return token

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { deactivatedAt: true, lineUserId: true },
  })
  if (!dbUser || dbUser.deactivatedAt != null) {
    return null
  }
  if (token.lineUserId !== dbUser.lineUserId) {
    token.lineUserId = dbUser.lineUserId
  }
  return token
}
