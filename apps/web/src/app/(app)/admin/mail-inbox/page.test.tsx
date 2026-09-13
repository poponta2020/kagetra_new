import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { InferInsertModel } from 'drizzle-orm'
import { mailWorkerJobs, resultDrafts } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
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

/**
 * tournament-results 2026-09-13 改修 タスク2 用のローカルシードヘルパー。
 * `apps/web/src/test-utils/seed.ts` は他タスクと共有のため編集禁止 —
 * 手本は `apps/web/src/lib/result-import-visibility.test.ts`（タスク1）。
 */
type NewMailWorkerJob = InferInsertModel<typeof mailWorkerJobs>
type NewResultDraft = InferInsertModel<typeof resultDrafts>

// page.tsx はテストの時刻注入を受けない（実時刻で loadInFlight/StalledResultImportMailIds
// を呼ぶ）ので、ここでは実時刻基準でジョブの requestedAt を仕込む。
const INSIDE_WINDOW = new Date()
const OUTSIDE_WINDOW = new Date(Date.now() - 31 * 60 * 1000)

async function seedResultParseJob(
  requestedByUserId: string,
  mailId: number,
  overrides: Partial<NewMailWorkerJob> = {},
): Promise<void> {
  await testDb.insert(mailWorkerJobs).values({
    requestedByUserId,
    status: 'pending',
    kind: 'result_parse',
    payload: { mail_message_id: mailId, attachment_id: 1 },
    requestedAt: INSIDE_WINDOW,
    ...overrides,
  })
}

async function seedResultDraft(
  mailId: number,
  overrides: Partial<NewResultDraft> = {},
) {
  const [draft] = await testDb
    .insert(resultDrafts)
    .values({
      messageId: mailId,
      status: 'pending_review',
      parserVersion: 'test-1.0',
      ...overrides,
    })
    .returning()
  if (!draft) throw new Error('Failed to insert test result draft')
  return draft
}

describe('admin/mail-inbox list page (mail-triage-badge)', () => {
  beforeEach(async () => {
    await truncateAll()
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

describe('admin/mail-inbox 一覧の結果取込の除外/復活表示 (tournament-results 2026-09-13)', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('AC-23/38: 取込中（窓内の未終端 result_parse ジョブ）は未処理に出ない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'IN_FLIGHT_UNPROCESSED',
      triageStatus: 'unprocessed',
    })
    await seedResultParseJob(admin.id, mail.id)

    await renderPage()

    expect(screen.queryByText('IN_FLIGHT_UNPROCESSED')).toBeNull()
    expect(screen.getByText(/^未処理 \(0\)$/)).toBeTruthy()
  })

  it('AC-23/38: 取込中は処理済みにも出ない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'IN_FLIGHT_PROCESSED',
      triageStatus: 'processed',
    })
    await seedResultParseJob(admin.id, mail.id)

    await renderPage()

    expect(screen.queryByText('IN_FLIGHT_PROCESSED')).toBeNull()
    // 処理済みが 0 件になるので折りたたみセクション自体が出ない。
    expect(screen.queryByText(/処理済み（最新/)).toBeNull()
  })

  it('AC-25: pending_review の結果ドラフトで未処理に復活し、承認画面への直リンクが出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'RESULT_PENDING_REVIEW',
      triageStatus: 'unprocessed',
    })
    const draft = await seedResultDraft(mail.id, { status: 'pending_review' })

    await renderPage()

    expect(screen.getByText('RESULT_PENDING_REVIEW')).toBeTruthy()
    const pill = screen.getByText('結果の承認待ち')
    const anchor = pill.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(
      `/admin/mail-inbox/result-drafts/${draft.id}`,
    )
  })

  it('AC-25: parse_failed の結果ドラフトで未処理に復活し、失敗表示が出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'RESULT_PARSE_FAILED',
      triageStatus: 'unprocessed',
    })
    await seedResultDraft(mail.id, { status: 'parse_failed' })

    await renderPage()

    expect(screen.getByText('RESULT_PARSE_FAILED')).toBeTruthy()
    expect(screen.getByText('結果の取込に失敗（再試行が必要）')).toBeTruthy()
  })

  it('AC-27: 30分超の滞留ジョブに「取込が進んでいません」警告が出る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'RESULT_STALLED',
      triageStatus: 'unprocessed',
    })
    await seedResultParseJob(admin.id, mail.id, { requestedAt: OUTSIDE_WINDOW })

    await renderPage()

    expect(screen.getByText('RESULT_STALLED')).toBeTruthy()
    expect(screen.getByText('取込が進んでいません')).toBeTruthy()
  })

  it('AC-38: parse_failed の古いドラフトがあっても、より新しい再取込ジョブが窓内なら非表示', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'RESULT_REQUEUED_IN_FLIGHT',
      triageStatus: 'unprocessed',
    })
    await seedResultDraft(mail.id, {
      status: 'parse_failed',
      updatedAt: OUTSIDE_WINDOW,
    })
    await seedResultParseJob(admin.id, mail.id, { requestedAt: INSIDE_WINDOW })

    await renderPage()

    expect(screen.queryByText('RESULT_REQUEUED_IN_FLIGHT')).toBeNull()
    expect(screen.getByText(/^未処理 \(0\)$/)).toBeTruthy()
  })

  it('AC-39: ジョブ要求より後にドラフトが書かれていれば滞留でなくドラフト状態を出す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'RESULT_DRAFT_AFTER_JOB',
      triageStatus: 'unprocessed',
    })
    await seedResultParseJob(admin.id, mail.id, { requestedAt: OUTSIDE_WINDOW })
    await seedResultDraft(mail.id, {
      status: 'parse_failed',
      updatedAt: new Date(OUTSIDE_WINDOW.getTime() + 60 * 1000),
    })

    await renderPage()

    expect(screen.getByText('RESULT_DRAFT_AFTER_JOB')).toBeTruthy()
    expect(screen.getByText('結果の取込に失敗（再試行が必要）')).toBeTruthy()
    expect(screen.queryByText('取込が進んでいません')).toBeNull()
  })

  it('AC-38: 承認待ち・取込失敗のカードには「対応不要」が出ない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const pendingMail = await createMailMessage({
      subject: 'RESULT_PENDING_NO_DISMISS',
      triageStatus: 'unprocessed',
    })
    await seedResultDraft(pendingMail.id, { status: 'pending_review' })
    const failedMail = await createMailMessage({
      subject: 'RESULT_FAILED_NO_DISMISS',
      triageStatus: 'unprocessed',
    })
    await seedResultDraft(failedMail.id, { status: 'parse_failed' })

    await renderPage()

    expect(screen.getByText('RESULT_PENDING_NO_DISMISS')).toBeTruthy()
    expect(screen.getByText('RESULT_FAILED_NO_DISMISS')).toBeTruthy()
    expect(screen.queryByText('対応不要')).toBeNull()
  })
})

// テスト DB プールの後始末はファイル末尾で 1 回だけ行う。describe ごとに
// closeTestDb() を置くと、先に終わった describe が pool を閉じてしまい、
// 後続 describe の truncateAll() が「閉じた pool は使えない」で全滅する
// （tournament-results 2026-09-13 改修で describe を足した際に実際に踏んだ）。
afterAll(async () => {
  await closeTestDb()
})
