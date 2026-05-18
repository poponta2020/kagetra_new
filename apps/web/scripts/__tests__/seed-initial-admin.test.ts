import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser, createAdmin } from '@/test-utils/seed'
import { seedInitialAdmin } from '../seed-initial-admin'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

describe('seedInitialAdmin', () => {
  it('inserts a new admin row when no user with the given email exists', async () => {
    const result = await seedInitialAdmin(testDb, {
      name: '管理者 太郎',
      email: 'admin1@example.com',
    })

    expect(result.kind).toBe('inserted')

    const rows = await testDb
      .select()
      .from(users)
      .where(eq(users.email, 'admin1@example.com'))
    expect(rows).toHaveLength(1)
    const inserted = rows[0]!
    expect(inserted.name).toBe('管理者 太郎')
    expect(inserted.role).toBe('admin')
    expect(inserted.isInvited).toBe(true)
    expect(inserted.grade).toBe('A')
    expect(inserted.lineUserId).toBeNull()
    expect(inserted.invitedAt).not.toBeNull()
  })

  it('is idempotent: a second call with the same email leaves a single admin row', async () => {
    await seedInitialAdmin(testDb, {
      name: '管理者 太郎',
      email: 'admin1@example.com',
    })
    const second = await seedInitialAdmin(testDb, {
      name: '管理者 太郎 (再実行)',
      email: 'admin1@example.com',
    })

    expect(second.kind).toBe('noop')

    const rows = await testDb
      .select()
      .from(users)
      .where(eq(users.email, 'admin1@example.com'))
    expect(rows).toHaveLength(1)
    // Name is NOT overwritten by a no-op call — the original name is preserved.
    expect(rows[0]!.name).toBe('管理者 太郎')
  })

  it('promotes an existing member to admin while preserving other fields', async () => {
    const member = await createUser({
      name: '一般 会員',
      email: 'member1@example.com',
      role: 'member',
      grade: 'C',
    })

    const result = await seedInitialAdmin(testDb, {
      name: 'IGNORED on promote',
      email: 'member1@example.com',
    })

    expect(result.kind).toBe('promoted')
    if (result.kind === 'promoted') {
      expect(result.previousRole).toBe('member')
      expect(result.userId).toBe(member.id)
    }

    const rows = await testDb
      .select()
      .from(users)
      .where(eq(users.email, 'member1@example.com'))
    expect(rows).toHaveLength(1)
    const promoted = rows[0]!
    expect(promoted.role).toBe('admin')
    expect(promoted.isInvited).toBe(true)
    // Other fields stay intact (only role / isInvited / updatedAt change on promote).
    expect(promoted.name).toBe('一般 会員')
    expect(promoted.grade).toBe('C')
  })

  it('is a no-op when the existing user is already an admin', async () => {
    const existing = await createAdmin({
      email: 'admin2@example.com',
      name: 'Existing Admin',
    })

    const result = await seedInitialAdmin(testDb, {
      name: 'IGNORED',
      email: 'admin2@example.com',
    })

    expect(result.kind).toBe('noop')
    if (result.kind === 'noop') {
      expect(result.userId).toBe(existing.id)
    }

    const rows = await testDb
      .select()
      .from(users)
      .where(eq(users.email, 'admin2@example.com'))
    expect(rows[0]!.name).toBe('Existing Admin')
    expect(rows[0]!.role).toBe('admin')
  })

  it('allows multiple admins as long as their emails differ', async () => {
    await seedInitialAdmin(testDb, {
      name: 'Admin A',
      email: 'adminA@example.com',
    })
    await seedInitialAdmin(testDb, {
      name: 'Admin B',
      email: 'adminB@example.com',
    })

    const all = await testDb
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
    expect(all).toHaveLength(2)
    const emails = all.map((u) => u.email).sort()
    expect(emails).toEqual(['adminA@example.com', 'adminB@example.com'])
  })
})
