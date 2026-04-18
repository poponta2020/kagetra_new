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
 * DB revalidation to catch user deactivation.
 *
 * Edge middleware uses only the base callback (via auth.config.ts) and is
 * kept DB-free. Any Node auth() call (Server Component / Server Action /
 * Route Handler) goes through this wrapper, so a deactivated user's session
 * is invalidated on the next request that reaches Node.
 */
export async function nodeJwtCallback(
  params: JwtParams,
  baseCallback: BaseJwt,
): Promise<JWT | null> {
  const token = await baseCallback(params)
  if (!token) return null

  // Skip the DB check on the initial sign-in path (user is set then) —
  // authorizeCredentials already enforced deactivatedAt there.
  if (params.user) return token

  const userId = (token.id ?? token.sub) as string | undefined
  if (!userId) return token

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { deactivatedAt: true },
  })
  if (!dbUser || dbUser.deactivatedAt != null) {
    return null
  }
  return token
}
