import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string): never => {
    // 本物の redirect() と同じく throw して以降の処理を止める。
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock('@/auth', () => ({ ...mockAuthModule(), unstable_update: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const { setRolePreviewAction } = await import('./role-preview-actions')

async function updateMock() {
  const mod = (await import('@/auth')) as unknown as {
    unstable_update: ReturnType<typeof vi.fn>
  }
  return mod.unstable_update
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('setRolePreviewAction', () => {
  beforeEach(async () => {
    redirectMock.mockClear()
    ;(await updateMock()).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未ログインは拒否・状態不変', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession(null)
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('env 未設定なら許可ユーザーでも拒否・状態不変（AC-1 fail-closed）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', '')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('許可リスト外の admin が member を指定 → 拒否・状態不変（AC-10）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'someone-else')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('許可された admin が member を指定 → viewAsRole=member で 1 回更新', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/',
    )
    const update = await updateMock()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ user: { viewAsRole: 'member' } })
  })

  it('プレビュー中の admin が 管理者 を指定 → 拒否されず viewAsRole=null で解除（AC-9）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'member', realRole: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'admin' }))).rejects.toThrow(
      'REDIRECT:/',
    )
    const update = await updateMock()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ user: { viewAsRole: null } })
  })

  it('プレビュー中に de-list された admin でも 管理者 へ戻せる（AC-10b 締め出し防止）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'someone-else')
    await setAuthSession({ id: 'u-admin', role: 'member', realRole: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'admin' }))).rejects.toThrow(
      'REDIRECT:/',
    )
    const update = await updateMock()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ user: { viewAsRole: null } })
  })

  it('プレビュー中に de-list された admin が さらに下位ロールへ切り替えるのは拒否', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'someone-else')
    await setAuthSession({ id: 'u-admin', role: 'vice_admin', realRole: 'admin' })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('許可された vice_admin が admin を指定 → 拒否・状態不変（AC-11 昇格不能）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-vice')
    await setAuthSession({ id: 'u-vice', role: 'vice_admin' })
    await expect(setRolePreviewAction(form({ role: 'admin' }))).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('許可された vice_admin が member を指定 → 更新される', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-vice')
    await setAuthSession({ id: 'u-vice', role: 'vice_admin' })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/',
    )
    expect(await updateMock()).toHaveBeenCalledWith({
      user: { viewAsRole: 'member' },
    })
  })

  it('role が enum 外 → 拒否・状態不変（AC-11）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(
      setRolePreviewAction(form({ role: 'superadmin' })),
    ).rejects.toThrow('REDIRECT:/403')
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('role が欠落 → 拒否・状態不変（AC-11）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(setRolePreviewAction(new FormData())).rejects.toThrow(
      'REDIRECT:/403',
    )
    expect(await updateMock()).not.toHaveBeenCalled()
  })

  it('returnTo の相対パスへ戻す（同一レスポンス内の stale セッション回避）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(
      setRolePreviewAction(form({ role: 'member', returnTo: '/events/12' })),
    ).rejects.toThrow('REDIRECT:/events/12')
  })

  it('returnTo に外部 URL を渡してもルートへ戻す（オープンリダイレクト防止）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    await expect(
      setRolePreviewAction(form({ role: 'member', returnTo: '//evil.com' })),
    ).rejects.toThrow('REDIRECT:/')
  })

  it('realRole を持たない古いセッションでも role をフォールバックに使う（回帰）', async () => {
    vi.stubEnv('ROLE_PREVIEW_USER_IDS', 'u-admin')
    const mod = (await import('@/auth')) as unknown as {
      auth: ReturnType<typeof vi.fn>
    }
    mod.auth.mockResolvedValue({
      user: { id: 'u-admin', role: 'admin' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    await expect(setRolePreviewAction(form({ role: 'member' }))).rejects.toThrow(
      'REDIRECT:/',
    )
    expect(await updateMock()).toHaveBeenCalledWith({
      user: { viewAsRole: 'member' },
    })
  })
})
