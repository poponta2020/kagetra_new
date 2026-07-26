import { describe, expect, it } from 'vitest'
import { testDatabaseNameForRoot } from '../src/test-db'

describe('testDatabaseNameForRoot', () => {
  it('is deterministic for the same root', () => {
    expect(testDatabaseNameForRoot('C:/tmp/impl-entry-management')).toBe(
      testDatabaseNameForRoot('C:/tmp/impl-entry-management'),
    )
  })

  it('normalizes Windows path separators and case to the same name', () => {
    // path.resolve は実行 OS の区切りに正規化するため、同一パスの表記揺れは同名に落ちる
    expect(testDatabaseNameForRoot('C:\\tmp\\impl-entry-management')).toBe(
      testDatabaseNameForRoot('C:/tmp/IMPL-Entry-Management'),
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
