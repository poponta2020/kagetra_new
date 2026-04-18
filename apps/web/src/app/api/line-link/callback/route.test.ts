import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// We must mock '@/auth' before importing the route, and we also need
// unstable_update to be a vi.fn so the route's call to it is a no-op.
vi.mock('@/auth', () => {
  const mod = mockAuthModule() as unknown as Record<string, unknown>
  mod.unstable_update = vi.fn().mockResolvedValue(null)
  return mod
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// next/headers `cookies()` shim: stateful per-test cookie jar. The route
// reads `line_link_state` and deletes it; we back it with a Map here.
const cookieJar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name)
      return value ? { name, value } : undefined
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
}))

const { GET } = await import('./route')
const { LINE_STATE_COOKIE } = await import('@/lib/line-oauth')

function makeRequest(search: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/line-link/callback')
  for (const [k, v] of Object.entries(search)) {
    url.searchParams.set(k, v)
  }
  // The route only reads `req.url` — a plain Request is enough.
  return new Request(url.toString()) as unknown as import('next/server').NextRequest
}

describe('GET /api/line-link/callback', () => {
  beforeEach(async () => {
    await truncateAll()
    cookieJar.clear()
    process.env.LINE_OAUTH_TEST_MODE = 'true'
  })
  afterEach(() => {
    delete process.env.LINE_OAUTH_TEST_MODE
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('正常系: state 一致 + code 有効 → lineUserId 保存 + / へリダイレクト', async () => {
    const user = await createUser({ name: 'alice', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, 'state-abc')

    const res = await GET(makeRequest({ code: 'code-xyz', state: 'state-abc' }))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const location = res.headers.get('location') ?? ''
    // Redirects to root (dashboard); may include trailing slash only.
    expect(location).toMatch(/\/$|\/\?/)

    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(updated?.lineUserId).toMatch(/^Utest-/)
    // Cookie must be cleared
    expect(cookieJar.has(LINE_STATE_COOKIE)).toBe(false)
  })

  it('state 不一致: DB を書き換えず /settings/line-link?error=state_mismatch に戻る', async () => {
    const user = await createUser({ name: 'bob', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, 'state-abc')

    const res = await GET(
      makeRequest({ code: 'code-xyz', state: 'different' }),
    )
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/settings/line-link')
    expect(location).toContain('error=state_mismatch')

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('error パラメータあり: DB を書き換えずエラー画面へ', async () => {
    const user = await createUser({ name: 'carol', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, 'state-abc')

    const res = await GET(
      makeRequest({ error: 'access_denied', state: 'state-abc' }),
    )
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=denied')

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('別会員の lineUserId と衝突: error=conflict を返す', async () => {
    // Pre-existing user already owns the Utest-xxxx ID that test-mode will produce.
    const callbackUser = await createUser({ name: 'me', lineUserId: null })
    const conflictId = `Utest-${callbackUser.id.slice(0, 8)}`
    await createUser({ name: 'other', lineUserId: conflictId })

    await setAuthSession({ id: callbackUser.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, 'state-abc')

    const res = await GET(
      makeRequest({ code: 'code-xyz', state: 'state-abc' }),
    )
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=conflict')

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, callbackUser.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('state cookie なし: error=state_mismatch', async () => {
    const user = await createUser({ name: 'dan', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })

    const res = await GET(
      makeRequest({ code: 'code-xyz', state: 'state-abc' }),
    )
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=state_mismatch')
  })
})
