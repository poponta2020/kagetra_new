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
 *
 * ## worker ごとの分離（fileParallelism を有効にするため）
 *
 * 上の worktree 単位の DB は**テンプレート**として使い、vitest の worker は
 * `<name>_w<VITEST_POOL_ID>` を `CREATE DATABASE … TEMPLATE` で複製して使う。
 * これで全テストファイルが1つの DB を奪い合わなくなり、`fileParallelism: false`
 * を外せる（web は 288 ファイル中 106 しか DB を使わないのに、全部が直列化されて
 * Vitest だけで11分かかっていた）。
 *
 * worker ごとに `drizzle-kit push` を走らせない理由: push は1回10〜20秒かかるので
 * worker 数だけ積むと並列化の利得を食い潰す。テンプレート複製は数百ミリ秒で済む。
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
 *
 * Case handling is platform-dependent: Windows paths are case-insensitive, so
 * they are lowercased before hashing (`C:\Tmp\X` ≡ `c:/tmp/x`). POSIX paths
 * are case-SENSITIVE — `/tmp/Feature` and `/tmp/feature` are different
 * worktrees and must not collide, so case is preserved in the hash there.
 * The slug is always lowercased (identifier cosmetics only; the hash carries
 * the distinction).
 */
export function testDatabaseNameForRoot(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let normalized = path.resolve(root).replace(/\\/g, '/')
  if (platform === 'win32') normalized = normalized.toLowerCase()
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 6)
  const slug = normalized
    .slice(normalized.lastIndexOf('/') + 1)
    .toLowerCase()
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
 *
 * Probes the target DB first: if it is reachable, no admin connection is made
 * at all — an explicitly provided TEST_DATABASE_URL keeps working even for
 * restricted users who may only CONNECT to that one database. Only a missing
 * database (3D000 invalid_catalog_name) falls through to creation via the
 * `postgres` maintenance DB.
 */
export async function ensureTestDatabase(dbUrl: string): Promise<void> {
  const probe = new Client({ connectionString: dbUrl })
  try {
    await probe.connect()
    return
  } catch (err) {
    if ((err as { code?: string }).code !== '3D000') throw err
  } finally {
    await probe.end().catch(() => {})
  }

  const url = new URL(dbUrl)
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const adminUrl = new URL(dbUrl)
  adminUrl.pathname = '/postgres'
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
    console.log('[test-db] Created database', dbName)
  } catch (err) {
    // 42P04 duplicate_database: 並行プロセスが同時に作成した場合は成功扱い
    if ((err as { code?: string }).code !== '42P04') throw err
  } finally {
    await client.end()
  }
}

// ---------------------------------------------------------------------------
// worker ごとの DB（テンプレート複製）
// ---------------------------------------------------------------------------

/** `_w<数字>` の suffix を落として「テンプレート DB の URL」に戻す（冪等化のため）。 */
function stripWorkerSuffix(dbUrl: string): string {
  const url = new URL(dbUrl)
  url.pathname = '/' + decodeURIComponent(url.pathname.replace(/^\//, '')).replace(/_w\d+$/, '')
  return url.toString()
}

/** URL から DB 名を取り出す。 */
export function databaseNameOf(dbUrl: string): string {
  return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, ''))
}

/** DB 名を差し替えた URL を返す。 */
function withDatabaseName(dbUrl: string, name: string): string {
  const url = new URL(dbUrl)
  url.pathname = '/' + name
  return url.toString()
}

/**
 * この vitest worker が使う DB の URL。
 *
 * **`VITEST_POOL_ID` を使う（`VITEST_WORKER_ID` ではない）。** 両者は別物で、
 * ここを取り違えるとテスト DB が worker 数ではなく**テストファイル数**だけ作られる:
 *
 * - `VITEST_POOL_ID` … プールの**枠**番号（1..maxWorkers）。同じ枠に流れる
 *   テストファイルは常に直列なので、DB を共有しても truncate/insert は決定的
 * - `VITEST_WORKER_ID` … worker インスタンスごとの**通し番号**。既定の
 *   `isolate: true` ではテストファイルごとに worker を作り直すため単調増加する
 *
 * 実測（2026-09-07・web 288 ファイル）: `VITEST_WORKER_ID` で複製したところ DB が
 * 202 個まで増え、10MB のテンプレート複製で tmpfs 3.2G を使い切って
 * `could not write block N: No space left on device` で 72 ファイルが落ちた。
 * `VITEST_POOL_ID` なら上限は maxWorkers（このマシンで 11）＝約 110MB に収まる。
 *
 * **冪等** —— 既に `_w<N>` が付いた URL を渡しても二重に付かない
 * （`vitest.setup.ts` が `TEST_DATABASE_URL` を上書きするため、同じプロセスで
 * 再解決されうる）。
 */
export function resolveWorkerTestDatabaseUrl(baseUrl = resolveTestDatabaseUrl()): string {
  const template = stripWorkerSuffix(baseUrl)
  const poolId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '1'
  const suffix = String(poolId).replace(/[^0-9]/g, '') || '1'
  return withDatabaseName(template, `${databaseNameOf(template)}_w${suffix}`)
}

/** 管理接続（`postgres` メンテナンス DB）を開く。 */
async function adminClient(dbUrl: string): Promise<Client> {
  const adminUrl = new URL(dbUrl)
  adminUrl.pathname = '/postgres'
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  return client
}

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`

/**
 * worker の DB をテンプレートから複製する（既にあれば何もしない）。
 *
 * 並行する worker が同じテンプレートから同時に複製すると Postgres が
 * `55006 object_in_use`（テンプレートに他の接続がある）を返すことがあるので、
 * 短いバックオフで数回リトライする。`42P04 duplicate_database` は他の worker が
 * 先に作っただけなので成功扱い。
 */
export async function ensureWorkerTestDatabase(
  workerUrl: string,
  templateUrl = stripWorkerSuffix(workerUrl),
): Promise<void> {
  const probe = new Client({ connectionString: workerUrl })
  try {
    await probe.connect()
    return
  } catch (err) {
    if ((err as { code?: string }).code !== '3D000') throw err
  } finally {
    await probe.end().catch(() => {})
  }

  const target = databaseNameOf(workerUrl)
  const template = databaseNameOf(templateUrl)
  const client = await adminClient(workerUrl)
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(`CREATE DATABASE ${quote(target)} TEMPLATE ${quote(template)}`)
        return
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code === '42P04') return // 他の worker が先に作った
        if (code === '55006' && attempt < 10) {
          await new Promise((r) => setTimeout(r, 150 * attempt))
          continue
        }
        throw err
      }
    }
  } finally {
    await client.end()
  }
}

/**
 * テンプレートから複製した worker DB を全部落とす。
 *
 * **globalSetup がスキーマを push した直後に呼ぶ。** 前回実行の worker DB が
 * 残っていると古いスキーマのまま再利用されてしまうため、毎回作り直させる。
 */
export async function dropWorkerTestDatabases(baseUrl = resolveTestDatabaseUrl()): Promise<number> {
  const template = stripWorkerSuffix(baseUrl)
  const prefix = `${databaseNameOf(template)}_w`
  const client = await adminClient(template)
  try {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${prefix.replace(/([%_])/g, String.raw`\$1`)}%`],
    )
    for (const row of rows) {
      // FORCE は PG13+。残った接続ごと落とす（テスト用 DB なので安全）。
      await client.query(`DROP DATABASE IF EXISTS ${quote(row.datname)} WITH (FORCE)`)
    }
    return rows.length
  } finally {
    await client.end()
  }
}
