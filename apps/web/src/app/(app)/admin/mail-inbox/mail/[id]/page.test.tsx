import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createMailMessage,
  createTournamentDraft,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: MailDetailPage } = await import('./page')

async function renderDetail(id: number | string) {
  const ui = await MailDetailPage({ params: Promise.resolve({ id: String(id) }) })
  return render(ui)
}

describe('admin/mail-inbox/mail/[id] detail page', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('件名・本文・triage アクション（未処理）を表示する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'detail subject',
      bodyText: 'detail body text',
      triageStatus: 'unprocessed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('detail subject')).toBeTruthy()
    expect(screen.getByText('未処理')).toBeTruthy()
    expect(screen.getByText('対応不要')).toBeTruthy()
    expect(screen.getByText('保留')).toBeTruthy()
  })

  it('draft があれば承認動線 [id] へのリンクを出す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'has draft',
      triageStatus: 'unprocessed',
    })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
    })

    await renderDetail(mail.id)

    const link = screen.getByText(/承認 \/ 却下 \/ 紐付けへ/)
    const anchor = link.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(`/admin/mail-inbox/${draft.id}`)
  })

  it('processed メールは「未処理に戻す」のみ（保留は出さない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'done detail',
      triageStatus: 'processed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('未処理に戻す')).toBeTruthy()
    expect(screen.queryByText('保留')).toBeNull()
    expect(screen.queryByText('対応不要')).toBeNull()
  })

  it('存在しない mail は notFound', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderDetail(999999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('不正な id は notFound', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderDetail('abc')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('member は /403 へ redirect', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    await expect(renderDetail(mail.id)).rejects.toThrow('NEXT_REDIRECT:/403')
  })
})
