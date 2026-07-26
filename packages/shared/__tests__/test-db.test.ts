import { describe, expect, it } from 'vitest'
import { testDatabaseNameForRoot } from '../src/test-db'

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
