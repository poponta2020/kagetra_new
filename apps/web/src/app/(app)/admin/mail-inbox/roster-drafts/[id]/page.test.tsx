import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  events,
  tournamentRosterImportDrafts,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createMailMessage, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
}))

const { default: RosterDraftReviewPage } = await import('./page')

async function seedDraft({
  validationIssues = [],
}: {
  validationIssues?: Array<{ code: string; message: string; sheetNames: string[] }>
} = {}) {
  const mail = await createMailMessage({ subject: 'A・B級申込名簿' })
  const [series] = await testDb.insert(tournamentSeries).values({ name: '画面テスト大会' }).returning()
  const [edition] = await testDb.insert(tournamentSeriesEditions).values({
    seriesId: series!.id,
    editionNumber: 3,
    year: 2030,
    status: 'held',
  }).returning()
  await testDb.insert(events).values({
    title: '第3回画面テスト大会',
    eventDate: '2030-05-01',
    editionId: edition!.id,
    eligibleGrades: ['A', 'B'],
  })
  const entry = (grade: 'A' | 'B', name: string) => ({
    rawName: name,
    rawKana: null,
    grade,
    rawAffiliation: null,
    rawDan: null,
    statusText: null,
    selectionOutcome: 'unknown',
    selectionExempt: false,
    seqNo: 1,
    sourceSheetName: `${grade}級`,
  })
  const [draft] = await testDb.insert(tournamentRosterImportDrafts).values({
    sourceKind: 'body',
    sourceMailMessageId: mail.id,
    parserVersion: 'test',
    status: 'pending_review',
    extractedPayload: {
      sheetName: 'A級',
      sheetNames: ['A級', 'B級'],
      entries: [entry('A', '選手A'), entry('B', '選手B')],
      validationIssues,
    },
  }).returning()
  return draft!
}

describe('roster draft review page', () => {
  beforeEach(async () => truncateAll())
  afterAll(async () => closeTestDb())

  it('adminへedition検索・event・用途・複数級の修正項目を表示する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const draft = await seedDraft()
    const ui = await RosterDraftReviewPage({ params: Promise.resolve({ id: String(draft.id) }) })
    render(ui)

    expect(screen.getByLabelText('開催回を検索')).toBeTruthy()
    expect(screen.getByText('原本用途')).toBeTruthy()
    expect(screen.getByText('対象イベント')).toBeTruthy()
    expect(screen.getAllByText('抽選状態')).toHaveLength(2)
    expect(screen.getAllByText(/確定名簿とする/)).toHaveLength(2)
  })

  it('memberは403へredirectする', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const draft = await seedDraft()
    await expect(
      RosterDraftReviewPage({ params: Promise.resolve({ id: String(draft.id) }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  it('検証エラーを表示し、採用フォームを表示しない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const draft = await seedDraft({
      validationIssues: [{
        code: 'duplicate_name_grade',
        message: '同一級に重複する氏名があります: 選手A',
        sheetNames: ['A級', '補足'],
      }],
    })
    const ui = await RosterDraftReviewPage({ params: Promise.resolve({ id: String(draft.id) }) })
    render(ui)

    expect(screen.getByText('原本の確認が必要です')).toBeTruthy()
    expect(screen.getByText(/同一級に重複する氏名があります/)).toBeTruthy()
    expect(screen.queryByLabelText('開催回を検索')).toBeNull()
  })
})
