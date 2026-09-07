import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser, createViceAdmin } from '@/test-utils/seed'
import { resolveLineChatPermissions } from './line-chat-authz'

describe('resolveLineChatPermissions', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('admin かつ line_user_id 紐付けありなら entry/payment とも実行できる', async () => {
    const admin = await createAdmin({ lineUserId: 'U-admin' })

    const result = await resolveLineChatPermissions(testDb, 'U-admin')

    expect(result).toEqual({ userId: admin.id, entry: true, payment: true })
  })

  it('vice_admin は payment のみ実行できる（entry は不可・AC-3）', async () => {
    const vice = await createViceAdmin({ lineUserId: 'U-vice' })

    const result = await resolveLineChatPermissions(testDb, 'U-vice')

    expect(result).toEqual({ userId: vice.id, entry: false, payment: true })
  })

  it('member は entry/payment とも実行できない', async () => {
    await createUser({ role: 'member', lineUserId: 'U-member' })

    const result = await resolveLineChatPermissions(testDb, 'U-member')

    expect(result.entry).toBe(false)
    expect(result.payment).toBe(false)
  })

  it('guest は entry/payment とも実行できない', async () => {
    await createGuest({ lineUserId: 'U-guest' })

    const result = await resolveLineChatPermissions(testDb, 'U-guest')

    expect(result.entry).toBe(false)
    expect(result.payment).toBe(false)
  })

  it('line_user_id が未紐付け（該当行なし）なら fail-closed で全て実行できず userId も null', async () => {
    // DB には何も無い状態で、DB に存在しない LINE userId を渡す。
    const result = await resolveLineChatPermissions(testDb, 'U-unknown-nobody')

    expect(result).toEqual({ userId: null, entry: false, payment: false })
  })

  it('退会者（deactivated_at あり）は role が admin でも fail-closed で全て実行できず userId も null', async () => {
    await createAdmin({ lineUserId: 'U-deactivated-admin', deactivatedAt: new Date() })

    const result = await resolveLineChatPermissions(testDb, 'U-deactivated-admin')

    expect(result).toEqual({ userId: null, entry: false, payment: false })
  })

  it('lineUserId が null なら DB を引かずに fail-closed で全て実行できない', async () => {
    const result = await resolveLineChatPermissions(testDb, null)

    expect(result).toEqual({ userId: null, entry: false, payment: false })
  })

  it('lineUserId が undefined なら DB を引かずに fail-closed で全て実行できない', async () => {
    const result = await resolveLineChatPermissions(testDb, undefined)

    expect(result).toEqual({ userId: null, entry: false, payment: false })
  })

  it('lineUserId が空文字なら DB を引かずに fail-closed で全て実行できない', async () => {
    const result = await resolveLineChatPermissions(testDb, '')

    expect(result).toEqual({ userId: null, entry: false, payment: false })
  })
})
