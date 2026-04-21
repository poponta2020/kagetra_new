import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JWT } from 'next-auth/jwt'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { nodeJwtCallback } from './node-jwt-callback'

// Stand-in for the edge-safe jwt callback from auth.config.ts. On first LINE
// sign-in the real base stashes `user.id` (= profile.sub) into
// `token.lineUserId`; we replicate that minimal behavior here so the Node
// wrapper can exercise its resolution step.
const edgeStyleBase = vi.fn(async ({ token, user, account }: { token: JWT; user?: { id: string }; account?: { provider: string } | null }): Promise<JWT> => {
  if (user && account?.provider === 'line') {
    ;(token as Record<string, unknown>).lineUserId = user.id
  }
  return token
})

describe('nodeJwtCallback — Node-side DB revalidation', () => {
  beforeEach(async () => {
    await truncateAll()
    edgeStyleBase.mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('初回サインイン: LINE user ID が DB にマッチ → id/role/name/lineLinkedAt/lineLinkedMethod を token に埋める', async () => {
    const user = await createUser({
      name: 'alice',
      lineUserId: 'Uabc123',
      role: 'member',
      lineLinkedAt: new Date('2026-04-20T10:00:00Z'),
      lineLinkedMethod: 'self_identify',
    })
    const result = await nodeJwtCallback(
      {
        token: {} as JWT,
        user: { id: 'Uabc123' } as { id: string },
        account: { provider: 'line' } as { provider: string },
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result.id).toBe(user.id)
    expect(result.role).toBe('member')
    expect(result.name).toBe('alice')
    expect(result.lineUserId).toBe('Uabc123')
    expect(result.lineLinkedAt).toBe('2026-04-20T10:00:00.000Z')
    expect(result.lineLinkedMethod).toBe('self_identify')
  })

  it('初回サインイン: LINE user ID が DB にいない → token.id 未設定のまま (middleware が /self-identify へ)', async () => {
    const result = await nodeJwtCallback(
      {
        token: {} as JWT,
        user: { id: 'Uunknown' } as { id: string },
        account: { provider: 'line' } as { provider: string },
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result.id).toBeUndefined()
    expect(result.lineUserId).toBe('Uunknown')
  })

  it('初回サインイン: deactivated 会員 → token.id 未設定 (signIn callback で既に拒否される想定の defense)', async () => {
    await createUser({
      name: 'retired',
      lineUserId: 'Uretired',
      deactivatedAt: new Date('2026-04-18T00:00:00Z'),
    })
    const result = await nodeJwtCallback(
      {
        token: {} as JWT,
        user: { id: 'Uretired' } as { id: string },
        account: { provider: 'line' } as { provider: string },
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result.id).toBeUndefined()
  })

  it('通常リクエスト: token.id がアクティブ user → token をそのまま返す', async () => {
    const user = await createUser({ name: 'active', deactivatedAt: null })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result.id).toBe(user.id)
  })

  it('通常リクエスト: token.id が deactivated user → 空 JWT を返してセッション無効化', async () => {
    const user = await createUser({
      name: 'retired-mid-session',
      deactivatedAt: new Date('2026-04-18T00:00:00Z'),
    })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).toEqual({})
  })

  it('通常リクエスト: token.id が DB に存在しない → 空 JWT', async () => {
    const result = await nodeJwtCallback(
      {
        token: { id: '00000000-0000-0000-0000-000000000000' } as JWT,
        user: undefined,
        trigger: undefined,
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).toEqual({})
  })

  it('通常リクエスト: token.id 無し (self-identify 未完了 session) → DB 検査せず token 返却', async () => {
    const result = await nodeJwtCallback(
      { token: { lineUserId: 'Upending' } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result.lineUserId).toBe('Upending')
    expect(result.id).toBeUndefined()
  })
})
