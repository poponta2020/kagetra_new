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

  it('AC-33: tier 分けは廃止され、未処理 pending_review が受信日降順の一本で並ぶ', async () => {
    // mail-ai-extract-refinements タスク10 (§3.2.8): confidence ベースの
    // 要対応/要確認/その他 tier 見出しは消え、未処理は受信日降順の一本になる。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const older = await createMailMessage({
      subject: 'OLDER_MAIL',
      triageStatus: 'unprocessed',
      receivedAt: new Date('2026-07-01T00:00:00Z'),
    })
    await createTournamentDraft({
      messageId: older.id,
      status: 'pending_review',
      // 旧フィールドが残っていても表示に使わないことの確認（AC-34 も参照）。
      confidence: '0.97',
    })
    const newer = await createMailMessage({
      subject: 'NEWER_MAIL',
      triageStatus: 'unprocessed',
      receivedAt: new Date('2026-07-15T00:00:00Z'),
    })
    await createTournamentDraft({
      messageId: newer.id,
      status: 'pending_review',
      confidence: '0.10',
    })
    await createMailMessage({
      subject: 'NO_DRAFT',
      status: 'ai_done',
      classification: 'noise',
      triageStatus: 'unprocessed',
      receivedAt: new Date('2026-07-10T00:00:00Z'),
    })

    await renderPage()

    expect(screen.getByText(/^未処理 \(3\)$/)).toBeTruthy()
    // tier 見出しが消えていること。
    expect(screen.queryByText(/^要対応/)).toBeNull()
    expect(screen.queryByText(/^要確認/)).toBeNull()
    expect(screen.queryByText(/^その他/)).toBeNull()
    // 受信日降順（新しい順）で並ぶこと。
    const subjects = screen
      .getAllByText(/_MAIL$/)
      .map((el) => el.textContent)
    expect(subjects).toEqual(['NEWER_MAIL', 'OLDER_MAIL'])
  })

  it('AC-33: ConfidenceBadge が一覧から消える（数値バッジが出ない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'confidence badge gone',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      confidence: '0.97',
    })

    await renderPage()

    // ConfidenceBadge は "高 (0.97)" のような文字列を出す。もう出ない。
    expect(screen.queryByText(/^高 \(/)).toBeNull()
    expect(screen.queryByText(/^中 \(/)).toBeNull()
    expect(screen.queryByText(/^低 \(/)).toBeNull()
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

  it('AC-18: カード表示名は formal_name になる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'formal name card',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        reason: '',
        events: [
          {
            unit_key: 'u1',
            event_date: '2026-08-01',
            eligible_grades: ['B'],
            formal_name: '第5回大阪大会B級',
            venue: null,
            entry_deadline: null,
            payment_deadline: null,
            payment_deadline_kind: '記載なし',
            payment_info_text: null,
            payment_method: null,
            entry_method: null,
            organizer_text: null,
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

    await renderPage()

    expect(screen.getByText('第5回大阪大会B級')).toBeTruthy()
  })

  it('AC-18: formal_name が無い単位は「開催日＋級」で表示される', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'fallback name card',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: {
        reason: '',
        events: [
          {
            unit_key: 'u1',
            event_date: '2026-08-02',
            eligible_grades: ['C'],
            formal_name: null,
            venue: null,
            entry_deadline: null,
            payment_deadline: null,
            payment_deadline_kind: '記載なし',
            payment_info_text: null,
            payment_method: null,
            entry_method: null,
            organizer_text: null,
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

    await renderPage()

    expect(screen.getByText('8/2(日) C級')).toBeTruthy()
  })

  it('AC-26: mail_kind ありのメールに種別ピルが出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({
      subject: 'kind pill mail',
      triageStatus: 'unprocessed',
      mailKind: 'confirmed_roster',
    })

    await renderPage()

    expect(screen.getByText('確定名簿')).toBeTruthy()
  })

  it('AC-26: mail_kind 未選択のメールには種別ピルが出ない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createMailMessage({
      subject: 'no kind pill mail',
      triageStatus: 'unprocessed',
      mailKind: null,
    })

    await renderPage()

    expect(screen.queryByText('大会案内')).toBeNull()
    expect(screen.queryByText('申込名簿')).toBeNull()
    expect(screen.queryByText('確定名簿')).toBeNull()
    expect(screen.queryByText('ノイズ')).toBeNull()
    expect(screen.queryByText('不明')).toBeNull()
  })

  it('AC-34: confidence 等の旧フィールドを持つドラフトを開いても壊れない', async () => {
    // 2.x 世代のペイロード（short_name_stem を持ち formal_name も持つ）を
    // 模し、confidence 列に値が入っていてもクラッシュせず formal_name を表示する。
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'legacy payload compat',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      confidence: '0.85',
      isCorrection: false,
      referencesSubject: null,
      extractedPayload: {
        short_name_stem: '札幌',
        is_tournament_announcement: true,
        events: [
          {
            unit_key: 'u1',
            event_date: '2026-09-01',
            eligible_grades: ['A'],
            formal_name: '第10回札幌大会A級',
          },
        ],
      },
    })

    await renderPage()

    expect(screen.getByText('第10回札幌大会A級')).toBeTruthy()
  })
})
