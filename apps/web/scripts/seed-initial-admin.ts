#!/usr/bin/env tsx
/**
 * Production-only helper: seed (or idempotently promote) an initial admin user
 * directly into the users table, bypassing LINE OAuth. This is the
 * bootstrapping step right after `apply-migrations.sh` so a real human can log
 * in via /api/auth/signin/line and have admin role — without it, no one can
 * mint other admins through the UI.
 *
 * Usage (from repo root, on the production host):
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/seed-initial-admin.ts --name="管理者 太郎" --email=admin@example.com
 *
 *   # grade is optional, defaults to 'A'
 *   ... --name=... --email=... --grade=B
 *
 * Idempotency:
 *   - email 一致行が無ければ INSERT (role='admin', isInvited=true, grade='A',
 *     lineUserId=null, invitedAt=now)
 *   - email 一致行があり role != 'admin' → UPDATE して admin に昇格 (name 等は不変)
 *   - email 一致行があり既に role='admin' → no-op
 *
 * The script intentionally does NOT take a `--line-user-id` — the operator
 * logs in via LINE Login first time, and self-identify (or admin-link) maps
 * the LINE id to this seeded admin row.
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Load apps/web/.env.local in dev (parity with dev-issue-cookie.ts); in
// production the systemd unit / shell wraps DATABASE_URL into process.env so
// the file may not exist — dotenv just no-ops in that case.
const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

const VALID_GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

export interface SeedInitialAdminInput {
  name: string
  email: string
  grade?: Grade
}

export type SeedInitialAdminResult =
  | { kind: 'inserted'; userId: string }
  | { kind: 'promoted'; userId: string; previousRole: string }
  | { kind: 'noop'; userId: string }

/**
 * Idempotently seed (or promote) an admin user.
 *
 * Exported as a pure function so vitest can drive it with the test DB
 * connection without touching process.argv / process.exit.
 */
export async function seedInitialAdmin(
  db: ReturnType<typeof drizzle>,
  input: SeedInitialAdminInput,
): Promise<SeedInitialAdminResult> {
  const grade: Grade = input.grade ?? 'A'

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)
  const current = existing[0]

  if (!current) {
    const inserted = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        role: 'admin',
        isInvited: true,
        invitedAt: new Date(),
        grade,
        lineUserId: null,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error('Failed to insert initial admin user')
    return { kind: 'inserted', userId: row.id }
  }

  if (current.role === 'admin') {
    return { kind: 'noop', userId: current.id }
  }

  const previousRole = current.role
  await db
    .update(users)
    .set({ role: 'admin', isInvited: true, updatedAt: new Date() })
    .where(eq(users.id, current.id))
  return { kind: 'promoted', userId: current.id, previousRole }
}

interface ParsedArgs {
  name: string
  email: string
  grade?: Grade
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let name: string | null = null
  let email: string | null = null
  let grade: Grade | undefined = undefined
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (!m) continue
    const [, key, value] = m
    if (key === 'name') {
      name = value!
    } else if (key === 'email') {
      email = value!
    } else if (key === 'grade') {
      if (!(VALID_GRADES as readonly string[]).includes(value!)) {
        throw new Error(
          `--grade must be one of ${VALID_GRADES.join(', ')} (got "${value}")`,
        )
      }
      grade = value as Grade
    }
  }
  if (!email) {
    throw new Error('--email is required (e.g. --email=admin@example.com)')
  }
  if (!name) {
    throw new Error('--name is required (e.g. --name="管理者 太郎")')
  }
  return { name, email, grade }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { name, email, grade } = parseArgs(argv)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool)
    const result = await seedInitialAdmin(db, { name, email, grade })
    if (result.kind === 'inserted') {
      process.stdout.write(
        `[seed-initial-admin] inserted admin ${result.userId} (${email})\n`,
      )
    } else if (result.kind === 'promoted') {
      process.stdout.write(
        `[seed-initial-admin] promoted ${result.userId} (${email}) ` +
          `from role=${result.previousRole} to admin\n`,
      )
    } else {
      process.stdout.write(
        `[seed-initial-admin] no-op: ${result.userId} (${email}) is already admin\n`,
      )
    }
  } finally {
    await pool.end()
  }
}

// CLI entry. When this file is imported (by vitest) `import.meta.url` won't
// match `process.argv[1]`, so the body is skipped — tests drive `seedInitialAdmin`
// directly with the test DB.
const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(
        `[seed-initial-admin] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
