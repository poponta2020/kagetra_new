import { vi } from 'vitest'

type UserRole = 'admin' | 'vice_admin' | 'member'
type LineLinkedMethod = 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link'

export type MockSessionUser = {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  /** 実効ロール（role-preview-switch でプレビュー中は下がる）。 */
  role: UserRole
  /**
   * 本物のロール。省略時は `role` と同値 = 非プレビュー状態になるので、
   * 既存の `setAuthSession({ id, role })` 呼び出しは全て従来どおりの
   * ベースラインとして成立する。プレビュー中を再現したいテストだけが
   * `{ role: 'member', realRole: 'admin' }` のように明示する。
   */
  realRole?: UserRole
  lineUserId?: string | null
  lineLinkedAt?: string | null
  lineLinkedMethod?: LineLinkedMethod | null
}

export type MockSession = {
  user: Required<Pick<MockSessionUser, 'id' | 'role'>> &
    Omit<MockSessionUser, 'id' | 'role' | 'realRole'> & {
      realRole: UserRole
      lineUserId: string | null
      lineLinkedAt: string | null
      lineLinkedMethod: LineLinkedMethod | null
    }
  expires: string
}

/**
 * Build a minimal session object compatible with auth() return shape under the
 * JWT strategy. Only fields consumed by Server Actions / layouts (id, role,
 * realRole, lineUserId, lineLinkedAt, lineLinkedMethod) are required.
 */
export function buildMockSession(user: MockSessionUser): MockSession {
  return {
    user: {
      ...user,
      realRole: user.realRole ?? user.role,
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
