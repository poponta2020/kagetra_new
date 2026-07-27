import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type {
  CreateEntryFormDraftInput,
  CreateEntryFormDraftResult,
  EntryFormContext,
  MemberNameInput,
  TemplateAnalysis,
} from './actions'

const analyzeTemplateActionMock = vi.fn<(input: unknown) => Promise<TemplateAnalysis>>()
const createEntryFormDraftActionMock =
  vi.fn<(input: CreateEntryFormDraftInput) => Promise<CreateEntryFormDraftResult>>()
const saveMemberNamesActionMock = vi.fn<(entries: MemberNameInput[]) => Promise<void>>()

vi.mock('./actions', () => ({
  analyzeTemplateAction: (input: unknown) => analyzeTemplateActionMock(input),
  createEntryFormDraftAction: (input: CreateEntryFormDraftInput) => createEntryFormDraftActionMock(input),
  saveMemberNamesAction: (entries: MemberNameInput[]) => saveMemberNamesActionMock(entries),
}))

const { EntryFormWizard } = await import('./EntryFormWizard')

function baseContext(overrides: Partial<EntryFormContext> = {}): EntryFormContext {
  return {
    groupId: 10,
    groupName: '第3回青森大会',
    eventDates: ['2026-06-13', '2026-06-14'],
    entryDeadline: '2026-05-27',
    organizer: '青森かるた会',
    templateCandidates: [
      {
        attachmentId: 1,
        filename: '第３回青森大会参加申込書.xlsx',
        sizeBytes: 100,
        receivedAt: '2026-05-08T00:30:00Z',
        mailSubject: '第3回青森大会のご案内',
      },
    ],
    members: [
      {
        userId: 'u1',
        displayName: '青木 悠人',
        needsNameInput: false,
        grade: 'A',
        dan: 4,
        familyName: '青木',
        givenName: '悠人',
        familyKana: 'あおき',
        givenKana: 'ゆうと',
        appearanceCount: 2,
        note: null,
      },
    ],
    appearanceReferenceDate: '2026-07-27',
    appearanceCompleteness: 'complete',
    appearanceIncompleteGrades: [],
    settings: {
      prefecture: '北海道',
      clubName: '北海道大学かるた会',
      managerName: '土居 悠太',
      phone: null,
      email: 'club@example.com',
      transferName: null,
    },
    sourceMailFrom: 'aomori-mail@example.com',
    latestDraft: null,
    ...overrides,
  }
}

function heuristicAnalysis(): TemplateAnalysis {
  return {
    cellMap: {
      sheets: [
        {
          sheetName: 'Sheet1',
          targetGrades: null,
          startRow: 12,
          columns: { grade: 'B', dan: 'E', familyName: 'F', givenName: 'G', fullKana: 'H' },
          headerCells: {},
          danFormat: 'n段',
        },
      ],
    },
    source: 'heuristic',
    warnings: [],
    organizerEmail: 'aomorikaruta@yahoo.co.jp',
    organizerInstructions: null,
    sheetNames: ['Sheet1'],
    sourceMailFrom: null,
    templateFilename: '第３回青森大会参加申込書.xlsx',
  }
}

describe('EntryFormWizard — 初期表示', () => {
  beforeEach(() => {
    analyzeTemplateActionMock.mockReset()
    createEntryFormDraftActionMock.mockReset()
    saveMemberNamesActionMock.mockReset()
  })

  it('ステップ1が初期表示され、サブタイトルに日程・締切が出る', () => {
    render(<EntryFormWizard context={baseContext()} currentUserName="土居" />)
    expect(screen.getByText('申込書を作成')).toBeTruthy()
    expect(screen.getByText('第3回青森大会（6/13〜14・大会申込締切 5/27）')).toBeTruthy()
  })
})

describe('EntryFormWizard — 一連のフロー', () => {
  beforeEach(() => {
    analyzeTemplateActionMock.mockReset()
    createEntryFormDraftActionMock.mockReset()
    saveMemberNamesActionMock.mockReset()
  })

  it('テンプレ選択→次へ→メール確認→作成成功で完了画面へ遷移する', async () => {
    analyzeTemplateActionMock.mockResolvedValue(heuristicAnalysis())
    createEntryFormDraftActionMock.mockResolvedValue({
      draftId: 42,
      status: 'created',
      imapError: null,
      unassignedCount: 0,
      overflowCount: 0,
    })

    render(<EntryFormWizard context={baseContext()} currentUserName="土居" />)

    fireEvent.click(screen.getByText('第３回青森大会参加申込書.xlsx'))
    await waitFor(() => expect(analyzeTemplateActionMock).toHaveBeenCalledWith({ groupId: 10, attachmentId: 1 }))
    await screen.findByText('✓ 自動判定に成功')

    fireEvent.click(screen.getByText('次へ — 会員の確認（1名）'))
    await screen.findByText('青木 悠人')

    fireEvent.click(screen.getByText('次へ — メールの確認'))
    const toInput = await screen.findByDisplayValue('aomorikaruta@yahoo.co.jp')
    expect(toInput).toBeTruthy()

    fireEvent.click(screen.getByText('Yahoo メールに下書きを作成'))

    await waitFor(() => expect(createEntryFormDraftActionMock).toHaveBeenCalledTimes(1))
    const payload = createEntryFormDraftActionMock.mock.calls[0]?.[0]
    expect(payload?.groupId).toBe(10)
    expect(payload?.attachmentId).toBe(1)
    expect(payload?.members).toEqual([
      {
        grade: 'A',
        dan: 4,
        familyName: '青木',
        givenName: '悠人',
        familyKana: 'あおき',
        givenKana: 'ゆうと',
        appearanceCount: 2,
        note: null,
      },
    ])
    expect(saveMemberNamesActionMock).not.toHaveBeenCalled()

    expect(await screen.findByText('下書きを作成しました')).toBeTruthy()
  })

  it('createEntryFormDraftAction が imap_failed を返すと失敗画面に遷移し、ダウンロードリンクが出る', async () => {
    analyzeTemplateActionMock.mockResolvedValue(heuristicAnalysis())
    createEntryFormDraftActionMock.mockResolvedValue({
      draftId: 99,
      status: 'imap_failed',
      imapError: 'imap.mail.yahoo.co.jp への接続がタイムアウトしました',
      unassignedCount: 0,
      overflowCount: 0,
    })

    render(<EntryFormWizard context={baseContext()} currentUserName="土居" />)
    fireEvent.click(screen.getByText('第３回青森大会参加申込書.xlsx'))
    await screen.findByText('✓ 自動判定に成功')
    fireEvent.click(screen.getByText('次へ — 会員の確認（1名）'))
    await screen.findByText('青木 悠人')
    fireEvent.click(screen.getByText('次へ — メールの確認'))
    await screen.findByDisplayValue('aomorikaruta@yahoo.co.jp')
    fireEvent.click(screen.getByText('Yahoo メールに下書きを作成'))

    expect(await screen.findByText('下書きを作成できませんでした')).toBeTruthy()
    const link = screen.getByText('生成した申込書をダウンロード') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/admin/entry-form/drafts/99')
  })

  it('姓名かな未登録の会員を編集して保存すると、作成時に saveMemberNamesAction が呼ばれる', async () => {
    analyzeTemplateActionMock.mockResolvedValue(heuristicAnalysis())
    createEntryFormDraftActionMock.mockResolvedValue({
      draftId: 1,
      status: 'created',
      imapError: null,
      unassignedCount: 0,
      overflowCount: 0,
    })

    const context = baseContext({
      members: [
        {
          userId: 'u1',
          displayName: '松田 結菜',
          needsNameInput: true,
          grade: 'B',
          dan: 3,
          familyName: '松田',
          givenName: '結菜',
          familyKana: null,
          givenKana: null,
          appearanceCount: 0,
          note: null,
        },
      ],
    })

    render(<EntryFormWizard context={context} currentUserName="土居" />)
    fireEvent.click(screen.getByText('第３回青森大会参加申込書.xlsx'))
    await screen.findByText('✓ 自動判定に成功')
    fireEvent.click(screen.getByText('次へ — 会員の確認（1名）'))

    // needsNameInput のため会員名は警告バナー(button)と行(span)の2箇所に別要素として
    // 出る。行側は button だが再帰的なアクセシブルネーム(級・段位等を含む)まで一致して
    // しまうため、完全一致のアクセシブルネームでバナー側のリンクを一意に狙う(AC-8)。
    fireEvent.click(await screen.findByRole('button', { name: '松田 結菜' }))
    fireEvent.change(await screen.findByLabelText(/ふりがな（姓）/), { target: { value: 'まつだ' } })
    fireEvent.change(screen.getByLabelText(/ふりがな（名）/), { target: { value: 'ゆいな' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    fireEvent.click(screen.getByText('次へ — メールの確認'))
    await screen.findByDisplayValue('aomorikaruta@yahoo.co.jp')
    fireEvent.click(screen.getByText('Yahoo メールに下書きを作成'))

    await waitFor(() => expect(saveMemberNamesActionMock).toHaveBeenCalledWith([
      { userId: 'u1', familyName: '松田', givenName: '結菜', familyKana: 'まつだ', givenKana: 'ゆいな' },
    ]))
  })
})
