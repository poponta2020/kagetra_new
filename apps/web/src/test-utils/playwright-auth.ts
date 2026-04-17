import { randomBytes } from 'node:crypto'
import { sessions } from '@kagetra/shared/schema'
import { testDb } from './db'
import { createUser, createAdmin } from './seed'

/**
 * Auth.js v5 HTTP cookie name. HTTPS uses '__Secure-authjs.session-token'.
 * See https://authjs.dev/getting-started/migrating-to-v5
 */
export const AUTHJS_SESSION_COOKIE = 'authjs.session-token'

export type SeededSession = {
  userId: string
  sessionToken: string
}

export async function seedMemberSession(
  overrides: Parameters<typeof createUser>[0] = {},
): Promise<SeededSession> {
  const user = await createUser(overrides)
  return issueSession(user.id)
}

export async function seedAdminSession(
  overrides: Parameters<typeof createAdmin>[0] = {},
): Promise<SeededSession> {
  const user = await createAdmin(overrides)
  return issueSession(user.id)
}

async function issueSession(userId: string): Promise<SeededSession> {
  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
  await testDb.insert(sessions).values({ sessionToken, userId, expires })
  return { userId, sessionToken }
}
