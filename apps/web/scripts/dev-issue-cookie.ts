/**
 * Dev-only helper: issue an Auth.js JWT session cookie for a seeded user, so
 * cookie-injection bypasses the LINE Login OAuth dance during local manual
 * testing. NOT for tests (use src/test-utils/playwright-auth.ts instead — that
 * one is wired into Playwright's seedAdminSession/seedMemberSession factories
 * and points at the test DB on port 5434).
 *
 * Usage (from repo root):
 *   pnpm --filter @kagetra/web dev:cookie               # admin (default)
 *   pnpm --filter @kagetra/web dev:cookie -- --role=member
 *   pnpm --filter @kagetra/web dev:cookie -- --role=vice_admin --name="副管理 太郎"
 *
 * Reads DATABASE_URL + AUTH_SECRET from apps/web/.env.local. Idempotent: looks
 * up by `email` first (stable per role) and inserts only if absent. The printed
 * cookie value goes into Chrome DevTools → Application → Cookies as
 *   name:    authjs.session-token
 *   domain:  localhost
 *   path:    /
 *   expires: 30 days
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Load apps/web/.env.local before anything that reads process.env.
const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { users } from '@kagetra/shared/schema'

type Role = 'admin' | 'vice_admin' | 'member'

const VALID_ROLES: readonly Role[] = ['admin', 'vice_admin', 'member']
const AUTHJS_SESSION_COOKIE = 'authjs.session-token'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

function parseArgs(): { role: Role; name: string | null } {
  let role: Role = 'admin'
  let name: string | null = null
  for (const arg of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (!m) continue
    const [, key, value] = m
    if (key === 'role') {
      if (!(VALID_ROLES as readonly string[]).includes(value!)) {
        throw new Error(
          `--role must be one of ${VALID_ROLES.join(', ')} (got "${value}")`,
        )
      }
      role = value as Role
    } else if (key === 'name') {
      name = value!
    }
  }
  return { role, name }
}

const ROLE_DEFAULT_NAME: Record<Role, string> = {
  admin: 'Dev Admin',
  vice_admin: 'Dev ViceAdmin',
  member: 'Dev Member',
}

const ROLE_EMAIL: Record<Role, string> = {
  admin: 'dev-admin@kagetra.local',
  vice_admin: 'dev-vice-admin@kagetra.local',
  member: 'dev-member@kagetra.local',
}

async function main() {
  const { role, name } = parseArgs()
  const databaseUrl = process.env.DATABASE_URL
  const authSecret = process.env.AUTH_SECRET
  if (!databaseUrl) throw new Error('DATABASE_URL not set (apps/web/.env.local)')
  if (!authSecret) throw new Error('AUTH_SECRET not set (apps/web/.env.local)')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool)
    const email = ROLE_EMAIL[role]
    const displayName = name ?? ROLE_DEFAULT_NAME[role]

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    let user = existing[0]
    if (!user) {
      const inserted = await db
        .insert(users)
        .values({
          name: displayName,
          email,
          role,
          isInvited: true,
          grade: 'A',
          lineUserId: null,
        })
        .returning()
      user = inserted[0]
      if (!user) throw new Error('Failed to insert dev user')
      process.stderr.write(`[dev-cookie] inserted ${role} ${user.id} (${email})\n`)
    } else {
      process.stderr.write(`[dev-cookie] reusing ${role} ${user.id} (${email})\n`)
    }

    const now = Math.floor(Date.now() / 1000)
    const token = await encode({
      salt: AUTHJS_SESSION_COOKIE,
      secret: authSecret,
      maxAge: SESSION_MAX_AGE,
      token: {
        sub: user.id,
        id: user.id,
        name: user.name,
        role: user.role,
        lineUserId: user.lineUserId ?? null,
        lineLinkedAt: user.lineLinkedAt?.toISOString() ?? null,
        lineLinkedMethod: user.lineLinkedMethod ?? null,
        iat: now,
        exp: now + SESSION_MAX_AGE,
        jti: crypto.randomUUID(),
      },
    })

    process.stdout.write(
      [
        '',
        '== Cookie injection ==',
        `Open  http://localhost:3000  in Chrome → DevTools → Application → Cookies → http://localhost:3000`,
        `Add a new cookie:`,
        `  Name:    ${AUTHJS_SESSION_COOKIE}`,
        `  Value:   ${token}`,
        `  Domain:  localhost`,
        `  Path:    /`,
        `  Expires: ${new Date((now + SESSION_MAX_AGE) * 1000).toISOString()}`,
        `Then reload — you'll be logged in as ${role} (${user.name}).`,
        '',
        '== Or via DevTools console (paste once) ==',
        `document.cookie = "${AUTHJS_SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}";`,
        '',
      ].join('\n'),
    )
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  process.stderr.write(`[dev-cookie] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
