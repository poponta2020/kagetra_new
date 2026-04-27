import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createMailMessage,
  createTournamentDraft,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// next/navigation needs to behave: notFound throws (Next does the same) and
// redirect throws so the page short-circuits. The page test here always seeds
// a draft + admin session, so neither should fire — but we still mock both so
// any regression surfaces as a clear thrown sentinel instead of a runtime
// import error under jsdom.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: MailDraftDetailPage } = await import('./page')

async function renderPage(draftId: number) {
  const ui = await MailDraftDetailPage({
    params: Promise.resolve({ id: String(draftId) }),
  })
  return render(ui)
}

describe('admin/mail-inbox/[id] page', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('ai_failed draft (extractedPayload: {}) renders without crashing and surfaces the recovery surface', async () => {
    // Reproduces the Phase 5 review r3 Blocker: detail page used to cast `{}`
    // to ExtractionPayload and call Object.entries(payload.extracted) → 500.
    // The page must render the failure fallback AND keep approve / reject /
    // re-extract / link controls reachable so the operator can recover.
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'ai_failed render test' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'ai_failed',
      extractedPayload: {},
      confidence: null,
    })

    await renderPage(draft.id)

    expect(screen.getByText('ai_failed render test')).toBeDefined()
    expect(screen.getByText('AI 失敗')).toBeDefined()
    expect(
      screen.getByText('AI 抽出に失敗しました（再抽出してください）'),
    ).toBeDefined()
    expect(screen.getByText('承認フォーム')).toBeDefined()
    expect(screen.getByText('再 AI 抽出')).toBeDefined()
    expect(screen.getByText('既存 events に紐付ける')).toBeDefined()
  })

  it('isCorrection=true で references_subject が null でも訂正版警告を表示する', async () => {
    // PR4 review r3 Should-fix: correction flag persisted on the draft column
    // must surface a warning even when the AI did not parse a referenced
    // subject. Otherwise the operator misses the heads-up entirely.
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'correction without ref' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      isCorrection: true,
      referencesSubject: null,
      extractedPayload: {
        is_tournament_announcement: true,
        confidence: 0.7,
        reason: 'looks like a correction notice',
        is_correction: true,
        references_subject: null,
        extracted: {
          title: '訂正版',
          formal_name: null,
          event_date: null,
          venue: null,
          fee_jpy: null,
          payment_deadline: null,
          payment_info_text: null,
          payment_method: null,
          entry_method: null,
          organizer_text: null,
          entry_deadline: null,
          eligible_grades: null,
          kind: null,
          capacity_total: null,
          capacity_a: null,
          capacity_b: null,
          capacity_c: null,
          capacity_d: null,
          capacity_e: null,
          official: null,
        },
      },
    })

    await renderPage(draft.id)

    expect(screen.getByText('⚠ 訂正版の可能性')).toBeDefined()
    expect(
      screen.getByText(
        'AI が訂正版と判断しましたが、参照件名は取得できませんでした。',
      ),
    ).toBeDefined()
  })
})
