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
const { LINE_STATE_COOKIE, buildLineLinkStateCookie } = await import(
  '@/lib/line-oauth'
)

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
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', user.id))

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
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', user.id))

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

  it('error パラメータあり: DB を書き換えずエラー画面へ、かつ state cookie が削除される', async () => {
    const user = await createUser({ name: 'carol', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', user.id))

    const res = await GET(
      makeRequest({ error: 'access_denied', state: 'state-abc' }),
    )
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=denied')

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(unchanged?.lineUserId).toBeNull()

    // state cookie must be dropped on every exit path (including error=) —
    // prevents stale state from lingering for the next attempt.
    expect(cookieJar.has(LINE_STATE_COOKIE)).toBe(false)
  })

  it('エラー時のリダイレクト先が req.url と同じ origin になる (NEXTAUTH_URL 非依存)', async () => {
    const user = await createUser({ name: 'host-check', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', user.id))

    // Override NEXTAUTH_URL to a bogus host; redirect must still use req.url
    const prev = process.env.NEXTAUTH_URL
    process.env.NEXTAUTH_URL = 'http://bogus.example.invalid'

    try {
      const res = await GET(makeRequest({ error: 'access_denied', state: 'state-abc' }))
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('http://localhost:3000/settings/line-link')
      expect(location).not.toContain('bogus.example.invalid')
    } finally {
      if (prev === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = prev
    }
  })

  it('別会員の lineUserId と衝突: error=conflict を返す', async () => {
    // Pre-existing user already owns the Utest-xxxx ID that test-mode will produce.
    const callbackUser = await createUser({ name: 'me', lineUserId: null })
    const conflictId = `Utest-${callbackUser.id.slice(0, 8)}`
    await createUser({ name: 'other', lineUserId: conflictId })

    await setAuthSession({ id: callbackUser.id, role: 'member', lineUserId: null })
    cookieJar.set(
      LINE_STATE_COOKIE,
      buildLineLinkStateCookie('state-abc', callbackUser.id),
    )

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

  it('cookie 署名が壊れている場合: error=state_mismatch, DB 変更なし', async () => {
    const user = await createUser({ name: 'tamper', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    // Truncate the signature so verifyLineLinkStateCookie rejects it.
    const tampered = buildLineLinkStateCookie('state-abc', user.id).slice(0, -4)
    cookieJar.set(LINE_STATE_COOKIE, tampered)

    const res = await GET(makeRequest({ code: 'code-xyz', state: 'state-abc' }))
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=state_mismatch')

    const unchanged = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(unchanged?.lineUserId).toBeNull()
  })

  it('cookie の userId と session の userId が不一致: error=state_mismatch で DB 変更なし', async () => {
    // alice started the flow; bob is logged in at callback time (tab switch).
    const alice = await createUser({ name: 'alice-start', lineUserId: null })
    const bob = await createUser({ name: 'bob-callback', lineUserId: null })
    await setAuthSession({ id: bob.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', alice.id))

    const res = await GET(makeRequest({ code: 'code-xyz', state: 'state-abc' }))
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('error=state_mismatch')

    // Neither alice nor bob should have been linked.
    const [aliceAfter, bobAfter] = await Promise.all([
      testDb.query.users.findFirst({ where: eq(users.id, alice.id) }),
      testDb.query.users.findFirst({ where: eq(users.id, bob.id) }),
    ])
    expect(aliceAfter?.lineUserId).toBeNull()
    expect(bobAfter?.lineUserId).toBeNull()
  })

  it('unstable_update が throw しても DB は更新され / にリダイレクトされる', async () => {
    // Regression guard for the Blocker: silent unstable_update failure must
    // not roll back the DB write. Recovery is handled by nodeJwtCallback
    // self-healing on the next Node render.
    const user = await createUser({ name: 'heal-on-next', lineUserId: null })
    await setAuthSession({ id: user.id, role: 'member', lineUserId: null })
    cookieJar.set(LINE_STATE_COOKIE, buildLineLinkStateCookie('state-abc', user.id))

    const authMod = (await import('@/auth')) as unknown as {
      unstable_update: ReturnType<typeof vi.fn>
    }
    authMod.unstable_update.mockRejectedValueOnce(new Error('jwt update boom'))

    const res = await GET(makeRequest({ code: 'code-xyz', state: 'state-abc' }))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const location = res.headers.get('location') ?? ''
    expect(location).toMatch(/\/$|\/\?/)

    const updated = await testDb.query.users.findFirst({
      where: eq(users.id, user.id),
    })
    expect(updated?.lineUserId).toMatch(/^Utest-/)
  })
})
