import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export type AuthorizedUser = {
  id: string
  name: string | null
  role: 'admin' | 'vice_admin' | 'member'
  mustChangePassword: boolean
}

// Generated once at module load. Comparing any input against this takes the
// same time as comparing against a real bcrypt(cost=12) hash, which keeps
// authorize() timing-constant regardless of whether the username exists or
// has a usable passwordHash — preventing user-enumeration side channels.
const DUMMY_HASH_PROMISE: Promise<string> = bcrypt.hash(
  'timing-safe-placeholder-not-a-real-password',
  12,
)

/**
 * Credentials provider `authorize` predicate, extracted from `auth.ts` so
 * tests can exercise it without running the NextAuth HTTP pipeline.
 *
 * Returns the user on successful match; null otherwise (Auth.js treats null
 * as CredentialsSignin → "ユーザー名またはパスワードが違います").
 */
export async function authorizeCredentials(
  raw: unknown,
): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw)
  if (!parsed.success) return null
  const { username, password } = parsed.data

  const user = await db.query.users.findFirst({
    where: eq(users.name, username),
  })

  // Always run bcrypt.compare so response time does not depend on whether the
  // user exists / has a passwordHash / is invited.
  const hashToCompare = user?.passwordHash ?? (await DUMMY_HASH_PROMISE)
  const passwordOk = await bcrypt.compare(password, hashToCompare)

  if (!user || !user.passwordHash || !user.isInvited || !passwordOk) {
    return null
  }

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}
