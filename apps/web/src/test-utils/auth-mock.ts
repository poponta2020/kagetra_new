import { vi } from 'vitest'

type UserRole = 'admin' | 'vice_admin' | 'member'
type LineLinkedMethod = 'self_identify' | 'admin_link' | 'account_switch'

export type MockSessionUser = {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  role: UserRole
  lineUserId?: string | null
  lineLinkedAt?: string | null
  lineLinkedMethod?: LineLinkedMethod | null
}

export type MockSession = {
  user: Required<Pick<MockSessionUser, 'id' | 'role'>> &
    Omit<MockSessionUser, 'id' | 'role'> & {
      lineUserId: string | null
      lineLinkedAt: string | null
      lineLinkedMethod: LineLinkedMethod | null
    }
  expires: string
}

/**
 * Build a minimal session object compatible with auth() return shape under the
 * JWT strategy. Only fields consumed by Server Actions / layouts (id, role,
 * lineUserId, lineLinkedAt, lineLinkedMethod) are required.
 */
export function buildMockSession(user: MockSessionUser): MockSession {
  return {
    user: {
      ...user,
      lineUserId: user.lineUserId ?? null,
      lineLinkedAt: user.lineLinkedAt ?? null,
      lineLinkedMethod: user.lineLinkedMethod ?? null,
    },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  }
}

/**
 * Use in test files to swap auth() with a mock. Call setAuthSession() in
 * beforeEach to control the session per test.
 *
 *   vi.mock('@/auth', () => mockAuthModule())
 *   setAuthSession({ id: 'u1', role: 'admin' })
 */
export function mockAuthModule() {
  const authFn = vi.fn()
  return {
    auth: authFn,
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: { GET: vi.fn(), POST: vi.fn() },
    __mockAuth: authFn,
  }
}

/**
 * Set the session returned by the mocked auth() call. Pass null to simulate
 * an unauthenticated request.
 */
export async function setAuthSession(
  user: MockSessionUser | null,
): Promise<void> {
  const mod = (await import('@/auth')) as unknown as {
    auth: ReturnType<typeof vi.fn>
  }
  if (user === null) {
    mod.auth.mockResolvedValue(null)
  } else {
    mod.auth.mockResolvedValue(buildMockSession(user))
  }
}
