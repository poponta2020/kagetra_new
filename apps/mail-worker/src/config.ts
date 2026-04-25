import { config as dotenvConfig } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Load repo-root .env so `pnpm --filter @kagetra/mail-worker start` (which uses
// apps/mail-worker as cwd) still picks up DATABASE_URL / YAHOO_IMAP_* defined
// at the monorepo root. Existing process.env wins (override defaults to false),
// so CI / docker can keep injecting via real env vars.
dotenvConfig({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

/**
 * Worker env contracts, split per concern so each subsystem only validates the
 * variables it actually uses. The earlier monolithic `ConfigSchema` pulled
 * `DATABASE_URL` into every load — including `consoleLogger()`, which is
 * created on the `--mock-imap --dry-run` smoke path that never opens a Pool —
 * making local fixture replays fail when `DATABASE_URL` was unset.
 *
 *   loadLogConfig()  → MAIL_WORKER_LOG_LEVEL only (always called)
 *   loadImapConfig() → YAHOO_IMAP_* (live IMAP path only)
 *   loadDbConfig()   → DATABASE_URL (DB writes only, gated by --dry-run)
 *
 * The required-DB check is now confined to `getDb()` so dry-run paths stay
 * runnable without a configured Postgres URL.
 */
const LogConfigSchema = z.object({
  MAIL_WORKER_LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),
})

const ImapConfigSchema = z.object({
  YAHOO_IMAP_HOST: z.string().min(1).default('imap.mail.yahoo.co.jp'),
  YAHOO_IMAP_PORT: z.coerce.number().int().positive().default(993),
  // Required at runtime, but PR1 supports a `--mock-imap` flag for fixture-based
  // pipeline runs (CI / local dev). To keep CI green without secrets, IMAP
  // credentials are validated as optional here and re-checked by `imap-client.ts`
  // only when actually connecting.
  YAHOO_IMAP_USER: z.string().optional(),
  YAHOO_IMAP_APP_PASSWORD: z.string().optional(),
})

const DbConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
})

export type LogConfig = z.infer<typeof LogConfigSchema>
export type ImapConfig = z.infer<typeof ImapConfigSchema>
export type DbConfig = z.infer<typeof DbConfigSchema>

/**
 * Lazy per-schema parse so unit tests can call `loadXxxConfig()` after
 * `vi.stubEnv(...)`. Cached afterwards so repeated calls within a single
 * process run return the same object.
 */
let cachedLog: LogConfig | null = null
let cachedImap: ImapConfig | null = null
let cachedDb: DbConfig | null = null

function configError(name: string, issues: z.ZodIssue[]): Error {
  const lines = issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  return new Error(`Invalid mail-worker ${name} env:\n${lines}`)
}

export function loadLogConfig(env: NodeJS.ProcessEnv = process.env): LogConfig {
  if (cachedLog) return cachedLog
  const parsed = LogConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('log', parsed.error.issues)
  cachedLog = parsed.data
  return cachedLog
}

export function loadImapConfig(env: NodeJS.ProcessEnv = process.env): ImapConfig {
  if (cachedImap) return cachedImap
  const parsed = ImapConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('imap', parsed.error.issues)
  cachedImap = parsed.data
  return cachedImap
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  if (cachedDb) return cachedDb
  const parsed = DbConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('db', parsed.error.issues)
  cachedDb = parsed.data
  return cachedDb
}

export function resetConfigForTests(): void {
  cachedLog = null
  cachedImap = null
  cachedDb = null
}
