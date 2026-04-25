import 'dotenv/config'
import { z } from 'zod'

/**
 * Worker env contract.
 *
 * IMAP credentials are required at runtime, but PR1 supports a `--mock-imap`
 * flag for fixture-based pipeline runs (CI / local dev). To keep CI green
 * without secrets, IMAP fields are validated as optional here and re-checked
 * by `imap-client.ts` only when actually connecting.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  YAHOO_IMAP_HOST: z.string().min(1).default('imap.mail.yahoo.co.jp'),
  YAHOO_IMAP_PORT: z.coerce.number().int().positive().default(993),
  YAHOO_IMAP_USER: z.string().optional(),
  YAHOO_IMAP_APP_PASSWORD: z.string().optional(),
  MAIL_WORKER_LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),
})

export type WorkerConfig = z.infer<typeof ConfigSchema>

/**
 * Lazily parse env on first access so unit tests can call `loadConfig()` after
 * `vi.stubEnv(...)`. Cached afterwards so the same object is returned to
 * downstream modules within a single process run.
 */
let cached: WorkerConfig | null = null

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (cached) return cached
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid mail-worker env:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

export function resetConfigForTests(): void {
  cached = null
}
