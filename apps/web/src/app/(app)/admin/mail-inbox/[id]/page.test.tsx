import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { eq } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createMailMessage,
  createTournamentDraft,
  createEntryGroup,
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
  // mail-ai-extract-refinements: 「再 AI 抽出」が client の
  // AIExtractConfirmDialog を使うようになり、useRouter を要求する。
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

  // AC-19: 訂正版ヒント（関連ドラフト・関連イベントの ILIKE 検索）は撤去した。
  // 訂正版の判断は人がやる運用に戻したため、AI 由来のフラグを持つ 2.x の既存
  // ドラフトを開いてもヒントは出ない（画面自体は壊れない ＝ AC-34）。
  it('AC-19: 訂正版ヒントが消えている（旧 isCorrection ドラフトでも出ない）', async () => {
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

    expect(screen.queryByText('⚠ 訂正版の可能性')).toBeNull()
    expect(
      screen.queryByText(
        'AI が訂正版と判断しましたが、参照件名は取得できませんでした。',
      ),
    ).toBeNull()
    // 承認フォームは通常どおり出る（画面が壊れていない）。
    expect(screen.getByText('承認フォーム')).toBeDefined()
  })

  // AC-7: source_mismatch は警告を出すが承認をブロックしない。
  it('AC-7: source_mismatch=true で警告バナーが出るが承認ボタンは押せる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'wrong document' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        reason: '渡された PDF は出場者名簿に見える',
        source_mismatch: true,
        events: [
          {
            unit_key: 'u1',
            event_date: null,
            eligible_grades: null,
            formal_name: null,
            venue: null,
            payment_deadline: null,
            payment_deadline_kind: '記載なし',
            payment_info_text: null,
            payment_method: null,
            entry_method: null,
            organizer_text: null,
            entry_deadline: null,
            kind: null,
            capacity_total: null,
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

    expect(
      screen.getByText('⚠ 渡した資料が要綱ではない可能性があります'),
    ).toBeDefined()
    // reason はバナーと「AI 抽出結果」の両方に出るので getAllByText で見る。
    expect(
      screen.getAllByText('渡された PDF は出場者名簿に見える').length,
    ).toBeGreaterThan(0)
    // ブロックしない: 承認フォームと登録ボタンは通常どおり出る。
    expect(screen.getByText('承認フォーム')).toBeDefined()
    expect(screen.getAllByText('このイベントを登録する').length).toBeGreaterThan(0)
  })

  it('新形式 events[] の分割案内を N フォームで描画する（未登録のみなら完了ボタンは出さない: r3 blocker）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({ subject: 'split announcement' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        reason: 'split',
        events: [
          buildUnit('u1', ['B'], '2031-01-11'),
          buildUnit('u2', ['C'], '2031-01-12'),
        ],
      },
    })

    const { container } = await renderPage(draft.id)

    const t1 = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    const t2 = container.querySelector(
      'input[name="u2__title"]',
    ) as HTMLInputElement
    // AC-17: 通称が未入力のあいだ合成結果は空（級だけの「B」を出さない）。
    expect(t1.value).toBe('')
    expect(t2.value).toBe('')

    // AC-15: 通称を入れると各単位の大会名が composeTitle で合成される。
    fireEvent.change(screen.getByLabelText('通称'), {
      target: { value: '大阪' },
    })
    expect(t1.value).toBe('大阪B')
    expect(t2.value).toBe('大阪C')

    // AC-16: 単位ごとに個別上書きできる。上書きした単位は通称の変更に追随しない。
    fireEvent.change(t2, { target: { value: '大阪C（会場変更）' } })
    fireEvent.change(screen.getByLabelText('通称'), {
      target: { value: '堺' },
    })
    expect(t1.value).toBe('堺B')
    expect(t2.value).toBe('大阪C（会場変更）')

    expect(screen.getByText('承認フォーム')).toBeDefined()
    expect(
      screen.getByText('この案内から 2 件のイベントを作成します'),
    ).toBeDefined()
    // r3 blocker: materialize 済みが 0 件のうちは「残りは作らず完了」を出さない
    // （0 イベントで draft を processed にして大会案内を取りこぼすのを防ぐ）。
    expect(screen.queryByText('残りは作らず完了')).toBeNull()
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
        entryGroupId: (await createEntryGroup()).id,
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
    // r3 blocker: 1 件以上 materialize 済みなら「残りは作らず完了」が出る。
    expect(screen.getByText('残りは作らず完了')).toBeDefined()
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
        entryGroupId: (await createEntryGroup()).id,
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
    payment_deadline: null,
    payment_deadline_kind: '記載なし',
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    kind: null,
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
  }
}
