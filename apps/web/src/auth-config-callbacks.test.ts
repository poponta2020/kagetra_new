import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { authConfig } from './auth.config'

// 合成テスト用。既存の管理者専用 Server Action / 管理画面を素のまま呼んで
// 「プレビュー中のセッションが実際の会員と同じく弾かれる」ことを実測する。
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/line-broadcast-guidelines', () => ({
  sendGuidelinesOnLink: vi.fn(async () => ({
    status: 'skipped' as const,
    sentCount: 0,
    totalCount: 0,
  })),
}))

const jwtCallback = authConfig.callbacks.jwt
const sessionCallback = authConfig.callbacks.session

type JwtParams = Parameters<typeof jwtCallback>[0]
type SessionParams = Parameters<typeof sessionCallback>[0]

async function callJwt(params: {
  token: JWT
  user?: unknown
  account?: unknown
  trigger?: 'signIn' | 'signUp' | 'update'
  session?: unknown
}): Promise<JWT> {
  return (await jwtCallback(params as unknown as JwtParams)) as JWT
}

async function callSession(token: JWT): Promise<Session> {
  const session = {
    user: { id: '', name: 'popon' },
    expires: '2099-01-01T00:00:00.000Z',
  } as unknown as Session
  return (await sessionCallback({ session, token } as unknown as SessionParams)) as Session
}

describe('authConfig.callbacks.session — 実効ロールの生成点', () => {
  it('viewAsRole 未設定なら実効ロール === 本物のロール（AC-18 の回帰）', async () => {
    const session = await callSession({ id: 'u1', role: 'admin' } as JWT)
    expect(session.user.role).toBe('admin')
    expect(session.user.realRole).toBe('admin')
  })

  it('viewAsRole=member / role=admin → 実効 member・realRole は admin のまま（AC-5）', async () => {
    const session = await callSession({
      id: 'u1',
      role: 'admin',
      viewAsRole: 'member',
    } as JWT)
    expect(session.user.role).toBe('member')
    expect(session.user.realRole).toBe('admin')
  })

  it('viewAsRole=vice_admin / role=admin → 実効 vice_admin', async () => {
    const session = await callSession({
      id: 'u1',
      role: 'admin',
      viewAsRole: 'vice_admin',
    } as JWT)
    expect(session.user.role).toBe('vice_admin')
    expect(session.user.realRole).toBe('admin')
  })

  it('viewAsRole=admin / role=vice_admin → 実効は vice_admin 止まり（AC-12 昇格不能）', async () => {
    const session = await callSession({
      id: 'u1',
      role: 'vice_admin',
      viewAsRole: 'admin',
    } as JWT)
    expect(session.user.role).toBe('vice_admin')
    expect(session.user.realRole).toBe('vice_admin')
  })

  it('enum 外の viewAsRole が JWT に混入しても実効は本物のロール（AC-11）', async () => {
    const session = await callSession({
      id: 'u1',
      role: 'member',
      viewAsRole: 'superadmin',
    } as unknown as JWT)
    expect(session.user.role).toBe('member')
  })

  it('viewAsRole=null は非プレビュー扱い', async () => {
    const session = await callSession({ id: 'u1', role: 'admin', viewAsRole: null } as JWT)
    expect(session.user.role).toBe('admin')
    expect(session.user.realRole).toBe('admin')
  })

  it('既存クレーム（id / lineUserId / lineLinkedAt / lineLinkedMethod）の転記は変わらない（回帰）', async () => {
    const session = await callSession({
      id: 'u1',
      role: 'member',
      lineUserId: 'Uabc',
      lineLinkedAt: '2026-04-20T10:00:00.000Z',
      lineLinkedMethod: 'self_identify',
    } as JWT)
    expect(session.user.id).toBe('u1')
    expect(session.user.lineUserId).toBe('Uabc')
    expect(session.user.lineLinkedAt).toBe('2026-04-20T10:00:00.000Z')
    expect(session.user.lineLinkedMethod).toBe('self_identify')
  })
})

describe('authConfig.callbacks.jwt — update パッチ経路', () => {
  // この経路は Server Action 専用ではない。Auth.js の `POST /api/auth/session`
  // が認証済みクライアントの任意ペイロードをそのまま渡してくるため、許可
  // リスト判定はここにも要る。既定では許可ユーザーとして振る舞わせる。
  beforeEach(() => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('{ user: { viewAsRole: "member" } } を転記する', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'member' } },
    })
    expect(token.viewAsRole).toBe('member')
    // 本物のロールは絶対に書き換えない。
    expect(token.role).toBe('admin')
  })

  it('フラットな { viewAsRole: "member" } も転記する', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin' } as JWT,
      trigger: 'update',
      session: { viewAsRole: 'member' },
    })
    expect(token.viewAsRole).toBe('member')
  })

  it('viewAsRole: null は解除として必ず受け付ける', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin', viewAsRole: 'member' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: null } },
    })
    expect(token.viewAsRole).toBeNull()
  })

  it('enum 外の文字列では token を変えない（AC-11）', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin', viewAsRole: 'member' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'superadmin' } },
    })
    expect(token.viewAsRole).toBe('member')
  })

  it('viewAsRole を含まないパッチでは既存の viewAsRole を保つ', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin', viewAsRole: 'member' } as JWT,
      trigger: 'update',
      session: { user: { lineUserId: 'Unew' } },
    })
    expect(token.viewAsRole).toBe('member')
  })

  it('既存 3 フィールドの転記が壊れていない（回帰）', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin' } as JWT,
      trigger: 'update',
      session: {
        user: {
          lineUserId: 'Uxyz',
          lineLinkedAt: '2026-05-01T00:00:00.000Z',
          lineLinkedMethod: 'account_switch',
        },
      },
    })
    expect(token.lineUserId).toBe('Uxyz')
    expect(token.lineLinkedAt).toBe('2026-05-01T00:00:00.000Z')
    expect(token.lineLinkedMethod).toBe('account_switch')
  })

  it('許可リスト外のユーザーは POST /api/auth/session 相当の直接 update でもプレビューへ入れない（AC-1 / AC-2 / AC-10 の迂回防止）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'someone-else')
    const token = await callJwt({
      token: { id: 'u1', role: 'admin' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'member' } },
    })
    expect(token.viewAsRole).toBeUndefined()
  })

  it('env 未設定なら誰も直接 update でプレビューへ入れない（fail-closed）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
    const token = await callJwt({
      token: { id: 'u1', role: 'admin' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'member' } },
    })
    expect(token.viewAsRole).toBeUndefined()
  })

  it('許可リスト外でも viewAsRole: null（解除）は常に通る（締め出し防止）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'someone-else')
    const token = await callJwt({
      token: { id: 'u1', role: 'admin', viewAsRole: 'member' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: null } },
    })
    expect(token.viewAsRole).toBeNull()
  })

  it('許可ユーザーでも本物のロールより上は書き込めない（AC-11 昇格不能）', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'vice_admin' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'admin' } },
    })
    expect(token.viewAsRole).toBeUndefined()
  })

  it('token.id が無い（未紐付け）ユーザーは直接 update でプレビューへ入れない', async () => {
    const token = await callJwt({
      token: { sub: 'Uline-sub', role: 'admin' } as JWT,
      trigger: 'update',
      session: { user: { viewAsRole: 'member' } },
    })
    expect(token.viewAsRole).toBeUndefined()
  })

  it('新規 LINE サインインでは viewAsRole が落ちる＝再ログインでプレビュー解除（AC-16）', async () => {
    const token = await callJwt({
      token: { id: 'u1', role: 'admin', viewAsRole: 'member' } as JWT,
      user: { id: 'random-uuid' },
      account: { provider: 'line', providerAccountId: 'Uabc', type: 'oidc' },
      trigger: 'signIn',
    })
    expect(token.viewAsRole).toBeNull()
    expect(token.lineUserId).toBe('Uabc')
    const session = await callSession(token)
    expect(session.user.role).toBe('admin')
  })
})

describe('プレビュー中の実効ロールが既存の認可ガードに効く（合成テスト）', () => {
  it('管理者専用 Server Action は member プレビュー中の admin を実際の会員と同じく弾く（AC-7）', async () => {
    const { releaseChannel } = await import('./app/(app)/admin/line-channels/actions')

    // 本物の会員：拒否されるベースライン
    await setAuthSession({ id: 'u-member', role: 'member' })
    await expect(releaseChannel(1)).rejects.toThrow('Forbidden')

    // member プレビュー中の admin：まったく同じく拒否される
    await setAuthSession({ id: 'u-admin', role: 'member', realRole: 'admin' })
    await expect(releaseChannel(1)).rejects.toThrow('Forbidden')
  })

  it('管理者専用ページは member プレビュー中の admin を /403 へ飛ばす（AC-8）', async () => {
    const { default: LineGradeGroupsAdminPage } = await import(
      './app/(app)/admin/line-grade-groups/page'
    )

    await setAuthSession({ id: 'u-member', role: 'member' })
    await expect(LineGradeGroupsAdminPage()).rejects.toThrow('NEXT_REDIRECT')

    await setAuthSession({ id: 'u-admin', role: 'member', realRole: 'admin' })
    await expect(LineGradeGroupsAdminPage()).rejects.toThrow('NEXT_REDIRECT')
  })
})
