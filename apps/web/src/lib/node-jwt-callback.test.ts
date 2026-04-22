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
        account: { provider: 'line', providerAccountId: 'p', type: 'oidc' } as unknown as import('next-auth').Account,
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    const jwt = result as JWT
    expect(jwt.id).toBe(user.id)
    expect(jwt.role).toBe('member')
    expect(jwt.name).toBe('alice')
    expect(jwt.lineUserId).toBe('Uabc123')
    expect(jwt.lineLinkedAt).toBe('2026-04-20T10:00:00.000Z')
    expect(jwt.lineLinkedMethod).toBe('self_identify')
  })

  it('初回サインイン: LINE user ID が DB にいない → token.id 未設定のまま (middleware が /self-identify へ)', async () => {
    const result = await nodeJwtCallback(
      {
        token: {} as JWT,
        user: { id: 'Uunknown' } as { id: string },
        account: { provider: 'line', providerAccountId: 'p', type: 'oidc' } as unknown as import('next-auth').Account,
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    expect((result as JWT).id).toBeUndefined()
    expect((result as JWT).lineUserId).toBe('Uunknown')
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
        account: { provider: 'line', providerAccountId: 'p', type: 'oidc' } as unknown as import('next-auth').Account,
        trigger: 'signIn',
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    expect((result as JWT).id).toBeUndefined()
  })

  it('通常リクエスト: token.id がアクティブ user → token をそのまま返す', async () => {
    const user = await createUser({ name: 'active', deactivatedAt: null })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    expect((result as JWT).id).toBe(user.id)
  })

  it('通常リクエスト: token.id が deactivated user → null を返してセッション無効化', async () => {
    const user = await createUser({
      name: 'retired-mid-session',
      deactivatedAt: new Date('2026-04-18T00:00:00Z'),
    })
    const result = await nodeJwtCallback(
      { token: { id: user.id, sub: user.id } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).toBeNull()
  })

  it('通常リクエスト: token.id が DB に存在しない → null', async () => {
    const result = await nodeJwtCallback(
      {
        token: { id: '00000000-0000-0000-0000-000000000000' } as JWT,
        user: undefined,
        trigger: undefined,
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).toBeNull()
  })

  it('通常リクエスト: token.id 無し & lineUserId に該当 user 無し → token.id 未解決のまま', async () => {
    const result = await nodeJwtCallback(
      { token: { lineUserId: 'Upending' } as JWT, user: undefined, trigger: undefined },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    expect((result as JWT).lineUserId).toBe('Upending')
    expect((result as JWT).id).toBeUndefined()
  })

  it('post /self-identify: token.lineUserId あり & token.id 未設定 & DB に row あり → 次回 render で id を自動補完', async () => {
    // /self-identify 完了後、unstable_update({ lineLinkedAt, lineLinkedMethod }) は
    // id/role/name を渡さないため token.id は未設定のまま。次の render で
    // nodeJwtCallback が lineUserId → users.id を再解決して middleware の
    // /self-identify ループを抜けさせる。
    const user = await createUser({
      name: 'just-claimed',
      lineUserId: 'Uself-identified',
      role: 'member',
      lineLinkedAt: new Date('2026-04-22T03:00:00Z'),
      lineLinkedMethod: 'self_identify',
    })
    const result = await nodeJwtCallback(
      {
        token: { lineUserId: 'Uself-identified' } as JWT,
        user: undefined,
        trigger: undefined,
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    const jwt = result as JWT
    expect(jwt.id).toBe(user.id)
    expect(jwt.role).toBe('member')
    expect(jwt.name).toBe('just-claimed')
    expect(jwt.lineLinkedMethod).toBe('self_identify')
  })

  it('post /self-identify: lineUserId に該当するのが deactivated row → id 未設定のまま保持', async () => {
    // 管理者が直接ユーザーを deactivate した直後など、DB では無効化されているが
    // JWT には古い lineUserId のみ残っているケース。token.id が未設定のため
    // 解決 branch で deactivatedAt を見て id を書かず、middleware 側は次の gate
    // で /self-identify に回す (そこでも該当 row が見つからず進まない)。
    await createUser({
      name: 'retired',
      lineUserId: 'Uretired-in-db',
      deactivatedAt: new Date('2026-04-21T00:00:00Z'),
    })
    const result = await nodeJwtCallback(
      {
        token: { lineUserId: 'Uretired-in-db' } as JWT,
        user: undefined,
        trigger: undefined,
      },
      edgeStyleBase as unknown as Parameters<typeof nodeJwtCallback>[1],
    )
    expect(result).not.toBeNull()
    expect((result as JWT).id).toBeUndefined()
  })
})
