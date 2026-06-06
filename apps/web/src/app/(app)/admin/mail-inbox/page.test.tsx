import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createMailMessage,
  createTournamentDraft,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// Mirrors [id]/page.test.tsx — `notFound` / `redirect` rethrow so the page
// short-circuits cleanly under jsdom. `useRouter` is stubbed because
// TriggerFetchButton (Client Component) calls it during render.
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

const { default: MailInboxPage } = await import('./page')

async function renderPage() {
  const ui = await MailInboxPage()
  return render(ui)
}

describe('admin/mail-inbox list page (mail-triage-badge)', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未処理メールの件名が mail/[id] 詳細へのリンクになっている', async () => {
    // 全メール（draft 無し含む）に詳細導線を出すのが本機能の肝。件名 →
    // mail/[id] の wiring が壊れると本文確認・triage の入口が消える。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'detail link wiring',
      triageStatus: 'unprocessed',
    })

    await renderPage()

    const subj = screen.getByText('detail link wiring')
    const anchor = subj.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(`/admin/mail-inbox/mail/${mail.id}`)
  })

  it('draft があるメールは DraftCard が承認動線 [id] へリンクする', async () => {
    // 大会取込/紐付けの既存動線（draftId 詳細）は維持する。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'draft link',
      triageStatus: 'unprocessed',
    })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
    })

    await renderPage()

    const statusPill = screen.getByText('承認待ち')
    const anchor = statusPill.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(`/admin/mail-inbox/${draft.id}`)
  })

  it('未処理グループ内で要対応/要確認/その他 の tier に分かれる', async () => {
    // triage 第1階層「未処理」の中で、従来の conf ベース tier を維持する。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const highMail = await createMailMessage({
      subject: 'HIGH_CONF',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: highMail.id,
      status: 'pending_review',
      confidence: '0.97',
    })
    const midMail = await createMailMessage({
      subject: 'MID_CONF',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: midMail.id,
      status: 'pending_review',
      confidence: '0.72',
    })
    await createMailMessage({
      subject: 'NO_DRAFT',
      status: 'ai_done',
      classification: 'noise',
      triageStatus: 'unprocessed',
    })

    await renderPage()

    expect(screen.getByText(/^未処理 \(3\)$/)).toBeTruthy()
    expect(screen.getByText('要対応 (1)')).toBeTruthy()
    expect(screen.getByText('要確認 (1)')).toBeTruthy()
    expect(screen.getByText('その他 (1)')).toBeTruthy()
  })

  // mail-inbox-mailer: 保留 (deferred) セクションは廃止（2 状態化に伴い）。

  it('processed は「処理済み」セクションに入る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({
      subject: 'PROCESSED_MAIL',
      triageStatus: 'processed',
    })

    await renderPage()

    expect(screen.getByText(/処理済み（最新 1 件）/)).toBeTruthy()
    expect(screen.getByText('PROCESSED_MAIL')).toBeTruthy()
  })

  it('未処理カードに triage クイックアクション（対応不要）が出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({
      subject: 'quick action',
      triageStatus: 'unprocessed',
    })

    await renderPage()

    // mail-inbox-mailer: 「保留」ボタンは廃止（処理せず放置 = 暗黙の保留）。
    expect(screen.getByText('対応不要')).toBeTruthy()
  })

  it('未処理が 0 件なら「未処理のメールはありません」を表示する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({ subject: 'done', triageStatus: 'processed' })

    await renderPage()

    expect(screen.getByText(/未処理のメールはありません/)).toBeTruthy()
  })

  it('要対応 section の card に brand accent class が乗る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const highMail = await createMailMessage({
      subject: 'accent test',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: highMail.id,
      status: 'pending_review',
      confidence: '0.97',
    })

    await renderPage()

    const subj = screen.getByText('accent test')
    const card = subj.closest('[class*="border-l-brand"]')
    expect(card).not.toBeNull()
  })
})
