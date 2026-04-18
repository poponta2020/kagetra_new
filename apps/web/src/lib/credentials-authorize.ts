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
  if (!user || !user.passwordHash || !user.isInvited) return null

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return null

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}
