import { afterEach, describe, expect, it } from 'vitest'
import { resolveWorkerTestDatabaseUrl, testDatabaseNameForRoot } from '../src/test-db'

describe('testDatabaseNameForRoot', () => {
  it('is deterministic for the same root', () => {
    expect(testDatabaseNameForRoot('C:/tmp/impl-entry-management')).toBe(
      testDatabaseNameForRoot('C:/tmp/impl-entry-management'),
    )
  })

  it('normalizes separators and case on win32 to the same name', () => {
    expect(testDatabaseNameForRoot('C:\\tmp\\impl-entry-management', 'win32')).toBe(
      testDatabaseNameForRoot('C:/tmp/IMPL-Entry-Management', 'win32'),
    )
  })

  it('keeps case-sensitive POSIX worktrees distinct', () => {
    // Linux では /tmp/Feature と /tmp/feature は別ディレクトリ。同名に潰すと
    // 分離したはずの worktree 同士が再衝突するため、hash は case を保持する
    expect(testDatabaseNameForRoot('/tmp/Feature', 'linux')).not.toBe(
      testDatabaseNameForRoot('/tmp/feature', 'linux'),
    )
  })

  it('produces distinct names for distinct worktrees', () => {
    expect(testDatabaseNameForRoot('C:/tmp/worktree-a')).not.toBe(
      testDatabaseNameForRoot('C:/tmp/worktree-b'),
    )
  })

  it('produces distinct names even when basenames collide', () => {
    expect(testDatabaseNameForRoot('C:/tmp/a/kagetra_new')).not.toBe(
      testDatabaseNameForRoot('C:/tmp/b/kagetra_new'),
    )
  })

  it('yields a safe Postgres identifier within the 63-char limit', () => {
    const name = testDatabaseNameForRoot(
      'C:/Users/popon/some very-long directory (with spaces & symbols)/日本語パス',
    )
    expect(name).toMatch(/^kagetra_test_[a-z0-9_]+_[0-9a-f]{6}$/)
    expect(name.length).toBeLessThanOrEqual(63)
  })
})

describe('resolveWorkerTestDatabaseUrl', () => {
  const saved = {
    pool: process.env.VITEST_POOL_ID,
    worker: process.env.VITEST_WORKER_ID,
  }
  const restore = (key: 'VITEST_POOL_ID' | 'VITEST_WORKER_ID', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  afterEach(() => {
    restore('VITEST_POOL_ID', saved.pool)
    restore('VITEST_WORKER_ID', saved.worker)
  })

  const base = 'postgresql://kagetra:kagetra_dev@127.0.0.1:5434/kagetra_test_demo_abc123'

  // ★この優先順位が本体。`VITEST_WORKER_ID` はテストファイルごとに増える通し番号
  // なので、それで DB 名を作るとテンプレート複製がファイル数だけ積み上がって
  // tmpfs を食い潰す（2026-09-07 に実際に `No space left on device` で 72 ファイル
  // が落ちた）。プールの枠番号 `VITEST_POOL_ID` は 1..maxWorkers で頭打ちになる。
  it('prefers VITEST_POOL_ID over VITEST_WORKER_ID', () => {
    process.env.VITEST_POOL_ID = '3'
    process.env.VITEST_WORKER_ID = '187'
    expect(resolveWorkerTestDatabaseUrl(base)).toBe(`${base}_w3`)
  })

  it('falls back to VITEST_WORKER_ID when no pool id is set', () => {
    delete process.env.VITEST_POOL_ID
    process.env.VITEST_WORKER_ID = '4'
    expect(resolveWorkerTestDatabaseUrl(base)).toBe(`${base}_w4`)
  })

  it('falls back to worker 1 outside vitest', () => {
    delete process.env.VITEST_POOL_ID
    delete process.env.VITEST_WORKER_ID
    expect(resolveWorkerTestDatabaseUrl(base)).toBe(`${base}_w1`)
  })

  // vitest.setup.ts が TEST_DATABASE_URL を worker URL で上書きするため、
  // 同じプロセスで再解決されうる。二重に `_w<N>` が付くと別 DB を掴む
  it('is idempotent on an already-suffixed url', () => {
    process.env.VITEST_POOL_ID = '2'
    const once = resolveWorkerTestDatabaseUrl(base)
    expect(resolveWorkerTestDatabaseUrl(once)).toBe(once)
  })
})
