import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// 会員一覧のロール表示（AC-20）。
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const { default: MembersPage } = await import('./page')

async function renderPage() {
  const ui = await MembersPage()
  return render(ui)
}

describe('MembersPage のロール列', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('ロールが日本語ラベルで表示され、生の enum が出ない（AC-20）', async () => {
    // 名前に enum 由来の語を含めない（ロール列だけを見たいため）。
    const admin = await createAdmin({ name: 'いち' })
    await createViceAdmin({ name: 'に' })
    await createUser({ name: 'さん' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await renderPage()

    // 各行の 2 列目がロール列。
    const roleCells = screen
      .getAllByRole('row')
      .slice(1) // ヘッダー行を除く
      .map((row) => row.querySelectorAll('td')[1]?.textContent)

    expect(roleCells).toEqual(['管理者', '副管理者', '一般会員'])
    for (const cell of roleCells) {
      expect(cell).not.toMatch(/admin|member/)
    }
  })

  // guest-role AC-27: ロール列は roleViewLabel が唯一の正典なので、enum に
  // guest を足した時点でここも追従する。生の 'guest' が漏れないことを固定する。
  it('ゲストは「ゲスト」と日本語で表示される（AC-27）', async () => {
    const admin = await createAdmin({ name: 'いち' })
    await createGuest({ name: 'よん' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await renderPage()

    const roleCells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td')[1]?.textContent)

    expect(roleCells).toContain('ゲスト')
    for (const cell of roleCells) {
      expect(cell).not.toMatch(/guest/)
    }
  })
})
