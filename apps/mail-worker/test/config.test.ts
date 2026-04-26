import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
})
