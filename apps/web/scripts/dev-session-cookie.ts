/**
 * Dev-only helper: mint an Auth.js JWT session cookie for an EXISTING user,
 * WITHOUT inserting anything. This is the prod-safe companion to
 * dev-issue-cookie.ts — that script INSERTS a synthetic `dev-*@kagetra.local`
 * user, which must NEVER hit a prod-connected DB. Use this one whenever
 * DATABASE_URL might point at production (e.g. via the SSH tunnel; see the
 * "prod DB connect" memory recipe).
 *
 * Reads DATABASE_URL + AUTH_SECRET from apps/web/.env.local, so it targets
 * whatever that file points at (local dev DB, or prod through the tunnel).
 * Uses raw SQL selecting only columns that exist in prod (the schema's
 * line_linked_method column is not present in the prod users table), so it
 * won't break when pointed at production.
 *
 * Usage (from repo root):
 *   pnpm --filter @kagetra/web dev:session                     # first admin (default)
 *   pnpm --filter @kagetra/web dev:session -- --role=member
 *   pnpm --filter @kagetra/web dev:session -- --email=someone@example.com
 *
 * Prints ONLY the cookie value to stdout (the chosen user goes to stderr), so
 * callers can capture it. Then set it as cookie `authjs.session-token`. The
 * `/show-app` command does this end-to-end for the in-app browser pane.
 */
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Load apps/web/.env.local before anything reads process.env.
const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { encode } from 'next-auth/jwt'

type Role = 'admin' | 'vice_admin' | 'member'
const VALID_ROLES: readonly Role[] = ['admin', 'vice_admin', 'member']
const AUTHJS_SESSION_COOKIE = 'authjs.session-token'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

function parseArgs(): { role: Role; email: string | null } {
  let role: Role = 'admin'
  let email: string | null = null
  for (const arg of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (!m) continue
    const [, key, value] = m
    if (key === 'role') {
      if (!(VALID_ROLES as readonly string[]).includes(value!)) {
        throw new Error(`--role must be one of ${VALID_ROLES.join(', ')} (got "${value}")`)
      }
      role = value as Role
    } else if (key === 'email') {
      email = value!
    }
  }
  return { role, email }
}

async function main() {
  const { role, email } = parseArgs()
  const databaseUrl = process.env.DATABASE_URL
  const authSecret = process.env.AUTH_SECRET
  if (!databaseUrl) throw new Error('DATABASE_URL not set (apps/web/.env.local)')
  if (!authSecret) throw new Error('AUTH_SECRET not set (apps/web/.env.local)')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const where = email ? 'email = $1' : 'role = $1'
    const arg = email ?? role
    // Prefer a LINE-bound user (real member) so middleware treats it as fully bound.
    const { rows } = await pool.query(
      `select id, name, role, line_user_id, line_linked_at
         from users
        where ${where}
        order by (line_user_id is not null) desc, id asc
        limit 1`,
      [arg],
    )
    const u = rows[0]
    if (!u) {
      throw new Error(
        `No existing user matches ${email ? `email=${email}` : `role=${role}`}. ` +
          'For a fresh local DB with no users, seed one with `pnpm --filter @kagetra/web dev:cookie` ' +
          '(that INSERTS a dev user — do NOT run it against prod).',
      )
    }

    const now = Math.floor(Date.now() / 1000)
    const token = await encode({
      salt: AUTHJS_SESSION_COOKIE,
      secret: authSecret,
      maxAge: SESSION_MAX_AGE,
      token: {
        sub: u.id,
        id: u.id,
        name: u.name,
        role: u.role,
        lineUserId: u.line_user_id ?? null,
        lineLinkedAt: u.line_linked_at ? new Date(u.line_linked_at).toISOString() : null,
        lineLinkedMethod: null,
        iat: now,
        exp: now + SESSION_MAX_AGE,
        jti: crypto.randomUUID(),
      },
    })

    process.stderr.write(`[dev-session] minted for role=${u.role} name=${u.name} id=${u.id}\n`)
    process.stdout.write(token + '\n')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  process.stderr.write(`[dev-session] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
