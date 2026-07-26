import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

/**
 * Per-worktree test database isolation.
 *
 * The vitest suites TRUNCATE tables and push schema (`drizzle-kit push --force`)
 * on every run. With a single shared `kagetra_test` DB, two sessions running
 * tests from different worktrees corrupt each other (deadlocks, FK violations,
 * 42P01 after a cross-worktree schema push — see
 * .claude/memory/feedback_shared_test_db_worktree_push_race.md).
 *
 * Unless TEST_DATABASE_URL is set explicitly (CI does this; manual isolation
 * still works), each git worktree gets its own database on the same
 * `postgres-test` container, derived deterministically from the worktree root
 * path. Databases are cheap: the container is tmpfs, so they vanish on restart,
 * and `ensureTestDatabase` recreates them on demand.
 *
 * Limitation: two vitest processes in the SAME worktree still share a DB.
 * That case is covered by policy (`## parallel` in .claude/project-profile.md:
 * Wave workers do not run tests), not by this module.
 */

// 127.0.0.1 固定: Windows では localhost が IPv6 (::1) に解決され、Docker の
// port publish がコネクションをリセットして ECONNRESET になる
// (.claude/memory/feedback_windows_localhost_econnreset_docker_pg.md)。
const TEST_DB_BASE = 'postgresql://kagetra:kagetra_dev@127.0.0.1:5434'

/**
 * Explicit TEST_DATABASE_URL wins; otherwise derive a per-worktree DB URL.
 * Safe to call from any cwd inside the repo: it walks up to the worktree root,
 * so apps/web and apps/mail-worker in the same worktree resolve the same DB.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL
  if (explicit) return explicit
  return `${TEST_DB_BASE}/${deriveTestDatabaseName(process.cwd())}`
}

/** Derives the DB name from the enclosing git worktree root of `startDir`. */
export function deriveTestDatabaseName(startDir: string): string {
  return testDatabaseNameForRoot(findRepoRoot(startDir))
}

/**
 * Pure derivation from a worktree root path: stable per worktree, distinct
 * across worktrees, valid as an unquoted-safe Postgres identifier, ≤63 chars.
 */
export function testDatabaseNameForRoot(root: string): string {
  const normalized = path.resolve(root).replace(/\\/g, '/').toLowerCase()
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 6)
  const slug = normalized
    .slice(normalized.lastIndexOf('/') + 1)
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 24)
  return `kagetra_test_${slug}_${hash}`
}

function findRepoRoot(startDir: string): string {
  // worktree では .git はディレクトリではなくファイルなので existsSync で見る
  let dir = path.resolve(startDir)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(startDir)
    dir = parent
  }
}

/**
 * Creates the database if it does not exist yet (idempotent; tolerates a
 * concurrent creator). Call from vitest globalSetup before `drizzle-kit push`.
 */
export async function ensureTestDatabase(dbUrl: string): Promise<void> {
  const url = new URL(dbUrl)
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const adminUrl = new URL(dbUrl)
  adminUrl.pathname = '/postgres'
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
      console.log('[test-db] Created database', dbName)
    }
  } catch (err) {
    // 42P04 duplicate_database: 並行プロセスが同時に作成した場合は成功扱い
    if ((err as { code?: string }).code !== '42P04') throw err
  } finally {
    await client.end()
  }
}
