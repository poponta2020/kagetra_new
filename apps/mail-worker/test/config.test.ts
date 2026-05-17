import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadCostGuardConfig,
  loadDbConfig,
  loadImapConfig,
  loadLogConfig,
  resetConfigForTests,
} from '../src/config.js'

describe('config split (per-concern loaders)', () => {
  beforeEach(() => {
    resetConfigForTests()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    resetConfigForTests()
  })

  describe('loadLogConfig', () => {
    // Regression guard for r4: the `--mock-imap --dry-run` smoke path constructs
    // a `consoleLogger()` which calls `loadLogConfig()`. Earlier this went
    // through a monolithic `loadConfig()` that also validated `DATABASE_URL`,
    // so local fixture replays failed when DB env was unset. Splitting per
    // concern keeps the dry-run path runnable without DB.
    it('does not require DATABASE_URL — `--mock-imap --dry-run` smoke path stays viable when DB env is unset', () => {
      vi.stubEnv('DATABASE_URL', '')
      expect(() => loadLogConfig()).not.toThrow()
      expect(loadLogConfig().MAIL_WORKER_LOG_LEVEL).toBe('info')
    })

    it('reads MAIL_WORKER_LOG_LEVEL from env', () => {
      vi.stubEnv('MAIL_WORKER_LOG_LEVEL', 'warn')
      expect(loadLogConfig().MAIL_WORKER_LOG_LEVEL).toBe('warn')
    })

    it('rejects unknown log levels with a clear error', () => {
      vi.stubEnv('MAIL_WORKER_LOG_LEVEL', 'verbose')
      expect(() => loadLogConfig()).toThrow(/log env/)
    })
  })

  describe('loadImapConfig', () => {
    it('does not require DATABASE_URL', () => {
      vi.stubEnv('DATABASE_URL', '')
      expect(() => loadImapConfig()).not.toThrow()
    })

    it('defaults host/port for Yahoo!Mail', () => {
      const cfg = loadImapConfig()
      expect(cfg.YAHOO_IMAP_HOST).toBe('imap.mail.yahoo.co.jp')
      expect(cfg.YAHOO_IMAP_PORT).toBe(993)
    })
  })

  describe('loadDbConfig', () => {
    it('throws when DATABASE_URL is empty (required check now lives inside getDb path)', () => {
      vi.stubEnv('DATABASE_URL', '')
      expect(() => loadDbConfig()).toThrow(/db env/)
    })
  })

  describe('loadCostGuardConfig', () => {
    it('defaults to 800 when MAIL_WORKER_PDF_SIZE_LIMIT_KB is unset', () => {
      expect(loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB).toBe(800)
    })

    it('treats an empty string the same as unset and falls back to default 800', () => {
      // Regression guard for r1 should-fix: `z.coerce.number()` would otherwise
      // accept `''` as `0`, silently disabling the cost guard whenever an
      // operator wrote `MAIL_WORKER_PDF_SIZE_LIMIT_KB=` with no value in .env.
      vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '')
      expect(loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB).toBe(800)
    })

    it('parses a non-empty numeric value', () => {
      vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '1500')
      expect(loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB).toBe(1500)
    })

    it('accepts 0 as the explicit "guard disabled" sentinel', () => {
      vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '0')
      expect(loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB).toBe(0)
    })

    it('rejects negative values with a clear error', () => {
      vi.stubEnv('MAIL_WORKER_PDF_SIZE_LIMIT_KB', '-1')
      expect(() => loadCostGuardConfig()).toThrow(/cost-guard env/)
    })
  })
})
