import { config as dotenvConfig } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Load repo-root .env so `pnpm --filter @kagetra/mail-worker start` (which uses
// apps/mail-worker as cwd) still picks up DATABASE_URL / YAHOO_IMAP_* defined
// at the monorepo root. Existing process.env wins (override defaults to false),
// so CI / docker can keep injecting via real env vars.
//
// Deferred behind a once-flag instead of running at module load: this module
// is now imported by @kagetra/web (PR4 reextract Server Action), and webpack
// statically analyses `new URL(staticString, import.meta.url)` as a bundled
// asset — leaking the worker-only dotenv side effect into the Next bundle as
// a "Module not found: ../../../.env" error. The first `load*Config()` call
// triggers it, which is the only path that needs it; the web bundle never
// hits that path for `loadLlmConfig` because the action passes the API key
// through process.env populated by Next's own .env loading.
let dotenvLoaded = false
function ensureDotenvLoaded(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  try {
    // The path is built from runtime fragments rather than a single literal so
    // bundlers (webpack in @kagetra/web) do not statically resolve it as an
    // asset reference and fail with "Module not found: ../../../.env". The
    // worker runtime still resolves the URL identically.
    const segments = ['..', '..', '..', '.env']
    const relative = segments.join('/')
    dotenvConfig({
      path: fileURLToPath(new URL(relative, import.meta.url)),
    })
  } catch {
    // Silent: web bundle has no resolvable .env at this URL, and Next's own
    // dotenv has already populated process.env by the time loadLlmConfig is
    // called from a Server Action. Worker callers always run from disk where
    // the URL resolves.
  }
}

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

const LlmConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
})

export type LogConfig = z.infer<typeof LogConfigSchema>
export type ImapConfig = z.infer<typeof ImapConfigSchema>
export type DbConfig = z.infer<typeof DbConfigSchema>

export interface LlmConfig {
  anthropicApiKey: string
}

/**
 * Lazy per-schema parse so unit tests can call `loadXxxConfig()` after
 * `vi.stubEnv(...)`. Cached afterwards so repeated calls within a single
 * process run return the same object.
 */
let cachedLog: LogConfig | null = null
let cachedImap: ImapConfig | null = null
let cachedDb: DbConfig | null = null
let cachedLlm: LlmConfig | null = null

function configError(name: string, issues: z.ZodIssue[]): Error {
  const lines = issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  return new Error(`Invalid mail-worker ${name} env:\n${lines}`)
}

export function loadLogConfig(env: NodeJS.ProcessEnv = process.env): LogConfig {
  if (cachedLog) return cachedLog
  ensureDotenvLoaded()
  const parsed = LogConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('log', parsed.error.issues)
  cachedLog = parsed.data
  return cachedLog
}

export function loadImapConfig(env: NodeJS.ProcessEnv = process.env): ImapConfig {
  if (cachedImap) return cachedImap
  ensureDotenvLoaded()
  const parsed = ImapConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('imap', parsed.error.issues)
  cachedImap = parsed.data
  return cachedImap
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  if (cachedDb) return cachedDb
  ensureDotenvLoaded()
  const parsed = DbConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('db', parsed.error.issues)
  cachedDb = parsed.data
  return cachedDb
}

/**
 * Validate the Anthropic credentials needed by `AnthropicSonnet46Extractor`.
 * Lazy on purpose: the `--mock-llm` smoke path constructs `FixtureLLMExtractor`
 * directly and must NOT require a real API key, so we never call this at
 * module load. The `--dry-run` path skips the AI phase entirely and likewise
 * avoids loading.
 */
export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  if (cachedLlm) return cachedLlm
  ensureDotenvLoaded()
  const parsed = LlmConfigSchema.safeParse(env)
  if (!parsed.success) throw configError('llm', parsed.error.issues)
  cachedLlm = { anthropicApiKey: parsed.data.ANTHROPIC_API_KEY }
  return cachedLlm
}

export function resetConfigForTests(): void {
  cachedLog = null
  cachedImap = null
  cachedDb = null
  cachedLlm = null
  // dotenvLoaded intentionally not reset: dotenv merges into process.env, so
  // re-running it has no value and would only re-trigger the webpack URL
  // analysis under bundlers.
}
