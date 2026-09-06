import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const { default: CircleBulkEditPage } = await import('./page')

async function renderPage() {
  const ui = await CircleBulkEditPage()
  return render(ui)
}

// travel-report S3/AC-6: 一括編集画面は管理者・副管理者のみ。
describe('CircleBulkEditPage', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('管理者は開ける、全会員が表になる', async () => {
    const admin = await createAdmin({ name: 'circle-page-admin' })
    await createUser({ name: '影虎 一郎' })
    await createUser({ name: '影虎 二郎' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'サークル所属の一括編集' })).toBeTruthy()
    expect(screen.getByText('影虎 一郎')).toBeTruthy()
    expect(screen.getByText('影虎 二郎')).toBeTruthy()
  })

  it('副管理者も開ける', async () => {
    const vice = await createViceAdmin({ name: 'circle-page-vice' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'サークル所属の一括編集' })).toBeTruthy()
  })

  it('一般会員は /403 へ', async () => {
    const member = await createUser({ name: 'circle-page-member', role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT:\/403/)
  })

  it('未認証は /403 へ', async () => {
    await setAuthSession(null)
    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT:\/403/)
  })
})
