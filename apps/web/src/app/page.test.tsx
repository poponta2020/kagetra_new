import { describe, it, expect, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// guest-role タスク4 (AC-11 の一部): `/` の着地先をロールで振り分ける。
// ゲストは `/dashboard` に入れない（許可リストで拒否される）ので `/events`
// へ、それ以外は従来どおり `/dashboard` へ送る。

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: Home } = await import('./page')

async function callHome(): Promise<string> {
  try {
    await Home()
    return 'NO_REDIRECT'
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return message.replace(/^REDIRECT:/, '')
  }
}

describe('/ (ルート)', () => {
  it('未認証は /auth/signin へ送る（回帰）', async () => {
    await setAuthSession(null)
    expect(await callHome()).toBe('/auth/signin')
  })

  it('一般会員は /dashboard へ送る（回帰）', async () => {
    await setAuthSession({ id: 'u-member', role: 'member' })
    expect(await callHome()).toBe('/dashboard')
  })

  it('管理者は /dashboard へ送る（回帰）', async () => {
    await setAuthSession({ id: 'u-admin', role: 'admin' })
    expect(await callHome()).toBe('/dashboard')
  })

  it('ゲストは /events へ送る', async () => {
    await setAuthSession({ id: 'u-guest', role: 'guest' })
    expect(await callHome()).toBe('/events')
  })
})
