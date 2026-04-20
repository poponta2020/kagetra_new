import { encode } from 'next-auth/jwt'
import { createUser, createAdmin } from './seed'

/**
 * Auth.js v5 HTTP cookie name. HTTPS uses '__Secure-authjs.session-token'.
 * See https://authjs.dev/getting-started/migrating-to-v5
 */
export const AUTHJS_SESSION_COOKIE = 'authjs.session-token'

/**
 * Must match the AUTH_SECRET configured for the Next.js dev server under test
 * (see playwright.config.ts → webServer.env.AUTH_SECRET).
 */
const AUTH_SECRET = 'e2e-test-secret-do-not-use-in-production'
const SALT = AUTHJS_SESSION_COOKIE

/**
 * Same default session lifetime as Auth.js (30 days).
 */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

export type SeededSession = {
  userId: string
  sessionToken: string
}

type IssueOptions = {
  role: 'admin' | 'vice_admin' | 'member'
  mustChangePassword?: boolean
  lineUserId?: string | null
}

async function issueJwtSession(
  userId: string,
  name: string | null,
  opts: IssueOptions,
): Promise<SeededSession> {
  const now = Math.floor(Date.now() / 1000)
  const token = await encode({
    salt: SALT,
    secret: AUTH_SECRET,
    maxAge: SESSION_MAX_AGE,
    token: {
      sub: userId,
      id: userId,
      name,
      role: opts.role,
      mustChangePassword: opts.mustChangePassword ?? false,
      lineUserId: opts.lineUserId ?? null,
      iat: now,
      exp: now + SESSION_MAX_AGE,
      jti: crypto.randomUUID(),
    },
  })
  return { userId, sessionToken: token }
}

export async function seedMemberSession(
  overrides: Parameters<typeof createUser>[0] = {},
): Promise<SeededSession> {
  const user = await createUser(overrides)
  return issueJwtSession(user.id, user.name, {
    role: user.role,
    mustChangePassword: user.mustChangePassword ?? false,
    lineUserId: user.lineUserId ?? null,
  })
}

export async function seedAdminSession(
  overrides: Parameters<typeof createAdmin>[0] = {},
): Promise<SeededSession> {
  const user = await createAdmin(overrides)
  return issueJwtSession(user.id, user.name, {
    role: user.role,
    mustChangePassword: user.mustChangePassword ?? false,
    lineUserId: user.lineUserId ?? null,
  })
}
