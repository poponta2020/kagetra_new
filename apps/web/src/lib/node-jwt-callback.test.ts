import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { nodeJwtCallback } from './node-jwt-callback'

// Minimal stand-in for the edge-safe jwt callback: returns the token as-is.
// The Node wrapper is what should add the DB revalidation.
const passThroughBase = vi.fn(async ({ token }: { token: unknown }) => token as never)

describe('nodeJwtCallback — Node-side DB revalidation', () => {
  beforeEach(async () => {
    await truncateAll()
    passThroughBase.mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('アクティブな会員は token が返る', async () => {
    const user = await createUser({ name: 'active', deactivatedAt: null })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id }, user: undefined, trigger: undefined },
      passThroughBase,
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe(user.id)
  })

  it('deactivatedAt セット済みの会員は null を返してセッションを即無効化する', async () => {
    const user = await createUser({
      name: 'retired',
      deactivatedAt: new Date('2026-04-18T00:00:00Z'),
    })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id }, user: undefined, trigger: undefined },
      passThroughBase,
    )
    expect(result).toBeNull()
  })

  it('DB に存在しない id は null を返す', async () => {
    const result = await nodeJwtCallback(
      {
        token: { id: '00000000-0000-0000-0000-000000000000', sub: '00000000-0000-0000-0000-000000000000' },
        user: undefined,
        trigger: undefined,
      },
      passThroughBase,
    )
    expect(result).toBeNull()
  })

  it('初回サインイン (user 付き) は DB 再検証をスキップして token をそのまま返す', async () => {
    // No user in DB — but because params.user is set, we skip revalidation.
    const result = await nodeJwtCallback(
      {
        token: { id: '00000000-0000-0000-0000-000000000000' },
        user: { id: '00000000-0000-0000-0000-000000000000' } as { id: string },
        trigger: 'signIn',
      },
      passThroughBase,
    )
    expect(result).not.toBeNull()
  })

  it('base callback が null を返した場合はそのまま null を返す', async () => {
    const nullBase = vi.fn(async () => null as unknown as never)
    const result = await nodeJwtCallback(
      { token: { id: 'any' }, user: undefined, trigger: undefined },
      nullBase,
    )
    expect(result).toBeNull()
  })
})
