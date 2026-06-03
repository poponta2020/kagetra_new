import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { eq } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
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
        short_name_stem: '訂正',
        events: [
          {
            unit_key: 'u1',
            event_date: null,
            eligible_grades: null,
            formal_name: null,
            venue: null,
            fee_jpy: null,
            payment_deadline: null,
            payment_info_text: null,
            payment_method: null,
            entry_method: null,
            organizer_text: null,
            entry_deadline: null,
            kind: null,
            capacity_a: null,
            capacity_b: null,
            capacity_c: null,
            capacity_d: null,
            capacity_e: null,
            official: null,
          },
        ],
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

  it('新形式 events[] の分割案内を N フォームで描画し「残りは作らず完了」ボタンを出す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'split announcement' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        is_tournament_announcement: true,
        confidence: 0.9,
        reason: 'split',
        short_name_stem: '大阪',
        events: [
          buildUnit('u1', ['B'], '2031-01-11'),
          buildUnit('u2', ['C'], '2031-01-12'),
        ],
      },
    })

    const { container } = await renderPage(draft.id)

    // Two namespaced title inputs, pre-filled via composeTitle.
    const t1 = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    const t2 = container.querySelector(
      'input[name="u2__title"]',
    ) as HTMLInputElement
    expect(t1.value).toBe('大阪B')
    expect(t2.value).toBe('大阪C')

    expect(screen.getByText('承認フォーム')).toBeDefined()
    expect(
      screen.getByText('この案内から 2 件のイベントを作成します'),
    ).toBeDefined()
    expect(screen.getByText('残りは作らず完了')).toBeDefined()
  })

  it('materialize 済み単位は登録済み表示・編集フォームを出さない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'partly materialized' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        is_tournament_announcement: true,
        confidence: 0.9,
        reason: 'split',
        short_name_stem: '大阪',
        events: [
          buildUnit('u1', ['B'], '2031-01-11'),
          buildUnit('u2', ['C'], '2031-01-12'),
        ],
      },
    })
    // Materialize u1 as an existing event linked to this draft.
    const [ev] = await testDb
      .insert(events)
      .values({
        title: '大阪B',
        eventDate: '2031-01-11',
        tournamentDraftId: draft.id,
        tournamentDraftUnitKey: 'u1',
      })
      .returning()
    if (!ev) throw new Error('event insert failed')

    const { container } = await renderPage(draft.id)

    // u1 registered → no editable title input; u2 still editable.
    expect(container.querySelector('input[name="u1__title"]')).toBeNull()
    expect(container.querySelector('input[name="u2__title"]')).not.toBeNull()
    expect(
      screen.getByText(
        'この案内から 2 件のイベントを作成します（うち登録済み 1 件）',
      ),
    ).toBeDefined()
  })

  it('approved draft は tournament_draft 由来の作成済みイベント一覧をリンク表示する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'approved with events' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
      extractedPayload: {
        is_tournament_announcement: true,
        confidence: 0.9,
        reason: 'split',
        short_name_stem: '大阪',
        events: [buildUnit('u1', ['B'], '2031-01-11')],
      },
    })
    const [ev] = await testDb
      .insert(events)
      .values({
        title: '大阪B',
        eventDate: '2031-01-11',
        tournamentDraftId: draft.id,
        tournamentDraftUnitKey: 'u1',
      })
      .returning()
    if (!ev) throw new Error('event insert failed')

    await renderPage(draft.id)

    // approved view: no approval form, but a link to the created event.
    expect(screen.queryByText('承認フォーム')).toBeNull()
    const link = screen.getByText(new RegExp(`events #${ev.id}`))
    expect(link.closest('a')?.getAttribute('href')).toBe(`/events/${ev.id}`)
  })
})

/** Minimal EventUnit-shaped object for new-format payload fixtures. */
function buildUnit(
  unitKey: string,
  grades: ('A' | 'B' | 'C' | 'D' | 'E')[] | null,
  eventDate: string | null,
) {
  return {
    unit_key: unitKey,
    event_date: eventDate,
    eligible_grades: grades,
    formal_name: null,
    venue: null,
    fee_jpy: null,
    payment_deadline: null,
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    kind: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
  }
}
