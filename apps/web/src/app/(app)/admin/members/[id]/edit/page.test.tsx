import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// ロールセクションの可視性（AC-1）。セクション内部の挙動は
// member-role-section.test.tsx が持つ。
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const { default: EditMemberPage } = await import('./page')

async function renderPage(id: string) {
  const ui = await EditMemberPage({ params: Promise.resolve({ id }) })
  return render(ui)
}

describe('EditMemberPage のロールセクション', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('管理者にはロールセクションが表示される', async () => {
    const admin = await createAdmin({ name: 'admin-page-1' })
    const target = await createUser({ name: 'target-page-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await renderPage(target.id)

    expect(screen.getByRole('heading', { name: 'ロール' })).toBeTruthy()
    expect(screen.getByLabelText('ロール')).toBeTruthy()
  })

  it('副管理者にはロールセクションが表示されない（AC-1）', async () => {
    const vice = await createViceAdmin({ name: 'vice-page-1' })
    const target = await createUser({ name: 'target-page-2' })
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await renderPage(target.id)

    expect(screen.queryByRole('heading', { name: 'ロール' })).toBeNull()
    expect(screen.queryByLabelText('ロール')).toBeNull()
    // 副管理者が編集ページ自体を開けること（既存挙動）は維持する。
    expect(screen.getByText(/会員編集/)).toBeTruthy()
  })

  it('自分自身の編集ページでは変更フォームが出ず理由が表示される（AC-21）', async () => {
    const admin = await createAdmin({ name: 'admin-page-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await renderPage(admin.id)

    expect(screen.getByRole('heading', { name: 'ロール' })).toBeTruthy()
    expect(screen.getByText(/ご自身のロールは変更できません/)).toBeTruthy()
    expect(screen.queryByLabelText('ロール')).toBeNull()
  })
})
