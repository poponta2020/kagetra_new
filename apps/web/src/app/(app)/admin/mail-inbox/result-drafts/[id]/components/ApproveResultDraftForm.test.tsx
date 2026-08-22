import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApproveResultDraftForm, type ApproveResultDraftFormClass } from './ApproveResultDraftForm'
import { approveResultDraft } from '../../../actions'
import type { ImportedGradeSummary } from '../actions'

// tournament-results タスク5: 部分承認（AC-10/AC-16）・差し替え操作・クライアント
// 側 0 件ガード（AC-13）・プリフィル（AC-4）を検証する。approveResultDraft は
// Server Action なので副作用を避けて mock する。
vi.mock('../../../actions', () => ({ approveResultDraft: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const approveResultDraftMock = vi.mocked(approveResultDraft)

const CLASSES: ApproveResultDraftFormClass[] = [
  { index: 0, className: 'A級', rawClassName: null, grade: 'A', participantCount: 10, matchCount: 20 },
  { index: 1, className: 'B級', rawClassName: null, grade: 'B', participantCount: 8, matchCount: 16 },
  { index: 2, className: 'C級', rawClassName: 'Ｃ級', grade: 'C', participantCount: 6, matchCount: 12 },
]

const EDITION_OPTIONS = [{ id: 1, label: '第1回テスト大会 (2026)' }]

function renderForm(
  overrides: Partial<React.ComponentProps<typeof ApproveResultDraftForm>> = {},
) {
  const loadImportedGrades =
    overrides.loadImportedGrades ?? vi.fn<(editionId: number) => Promise<ImportedGradeSummary[]>>()
  render(
    <ApproveResultDraftForm
      draftId={1}
      defaultTournamentName="第1回テスト大会"
      classes={CLASSES}
      editionOptions={EDITION_OPTIONS}
      loadImportedGrades={loadImportedGrades}
      {...overrides}
    />,
  )
  return { loadImportedGrades }
}

function classCheckbox(index: number): HTMLInputElement {
  return document.getElementById(`class-${index}`) as HTMLInputElement
}

function selectEdition(id: number) {
  fireEvent.change(screen.getByLabelText('開催回（結果原本の採用先）'), {
    target: { value: String(id) },
  })
}

describe('ApproveResultDraftForm — 級選択', () => {
  beforeEach(() => {
    approveResultDraftMock.mockReset()
    approveResultDraftMock.mockResolvedValue({ ok: true, tournamentId: 1 })
  })

  // AC-16: edition 未選択時は全級のチェックが ON。
  it('edition 未選択時は全級が既定でチェック済み', () => {
    renderForm()
    expect(classCheckbox(0).checked).toBe(true)
    expect(classCheckbox(1).checked).toBe(true)
    expect(classCheckbox(2).checked).toBe(true)
  })

  // AC-10: edition 選択後、突合結果で取込済みの grade は OFF + バッジ表示。
  it('edition 選択後、取込済みの grade は OFF になり「取込済み」を表示する', async () => {
    const loadImportedGrades = vi.fn(async (): Promise<ImportedGradeSummary[]> => [
      { grade: 'C', classCount: 1, tournamentNames: ['第1回テスト大会'] },
    ])
    renderForm({ loadImportedGrades })

    selectEdition(1)

    await waitFor(() => {
      expect(loadImportedGrades).toHaveBeenCalledWith(1)
    })
    await waitFor(() => {
      expect(classCheckbox(2).checked).toBe(false)
    })
    expect(classCheckbox(0).checked).toBe(true)
    expect(classCheckbox(1).checked).toBe(true)
    expect(screen.getByText('取込済み')).toBeTruthy()
  })

  // edition を空へ戻したら全級 ON へ戻る。
  it('edition を未選択へ戻すと全級 ON へ戻る', async () => {
    const loadImportedGrades = vi.fn(async (): Promise<ImportedGradeSummary[]> => [
      { grade: 'C', classCount: 1, tournamentNames: ['第1回テスト大会'] },
    ])
    renderForm({ loadImportedGrades })

    selectEdition(1)
    await waitFor(() => expect(classCheckbox(2).checked).toBe(false))

    fireEvent.change(screen.getByLabelText('開催回（結果原本の採用先）'), {
      target: { value: '' },
    })

    expect(classCheckbox(2).checked).toBe(true)
  })

  // AC-13: 全級のチェックを外すと submit disabled になり、強制 submit でも
  // approveResultDraft は呼ばれずエラー文言が出る。
  it('全級を外すと submit ボタンが disabled になり、強制 submit してもエラーになる', () => {
    const { container } = render(
      <ApproveResultDraftForm
        draftId={1}
        defaultTournamentName="第1回テスト大会"
        classes={CLASSES}
        editionOptions={EDITION_OPTIONS}
        loadImportedGrades={vi.fn()}
      />,
    )
    for (const cls of CLASSES) {
      fireEvent.click(classCheckbox(cls.index))
    }
    const submitButton = screen.getByText('承認して確定保存').closest('button') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    const form = container.querySelector('form')
    if (!form) throw new Error('form not found')
    fireEvent.submit(form)

    expect(screen.getByText('取り込む級を1つ以上選択してください')).toBeTruthy()
    expect(approveResultDraftMock).not.toHaveBeenCalled()
  })

  // AC-4: defaultEventDate / 大会名の初期値がフォームに入る。
  it('defaultTournamentName / defaultEventDate がフォームの初期値になる', () => {
    render(
      <ApproveResultDraftForm
        draftId={1}
        defaultTournamentName="第2回テスト大会"
        defaultEventDate="2026-09-27"
        classes={CLASSES}
        editionOptions={EDITION_OPTIONS}
        loadImportedGrades={vi.fn()}
      />,
    )
    expect((screen.getByLabelText(/^大会名/) as HTMLInputElement).value).toBe('第2回テスト大会')
    expect((screen.getByLabelText('開催日（任意）') as HTMLInputElement).value).toBe('2026-09-27')
  })

  // 選択した級の index だけが selectedClasses に入る。
  it('選択した級の index だけが selectedClasses に入る', async () => {
    renderForm()
    fireEvent.click(classCheckbox(1)) // B級を外す

    fireEvent.click(screen.getByText('承認して確定保存'))

    await waitFor(() => {
      expect(approveResultDraftMock).toHaveBeenCalled()
    })
    const fd = approveResultDraftMock.mock.calls[0]![1]
    expect(JSON.parse(fd.get('selectedClasses') as string)).toEqual([0, 2])
  })

  // AC-10 の差し替え: 取込済みの級を再チェックすると「差し替える」が現れ、
  // ON にした grade が replaceGrades に載って送信される。
  it('取込済みの級を再チェックし差し替えを ON にすると replaceGrades に載る', async () => {
    const loadImportedGrades = vi.fn(async (): Promise<ImportedGradeSummary[]> => [
      { grade: 'C', classCount: 1, tournamentNames: ['第1回テスト大会'] },
    ])
    renderForm({ loadImportedGrades })

    selectEdition(1)
    await waitFor(() => expect(classCheckbox(2).checked).toBe(false))

    // 再チェックすると差し替えチェックボックスが現れる。
    fireEvent.click(classCheckbox(2))
    const replaceCheckbox = screen.getByLabelText('この級を差し替える') as HTMLInputElement
    expect(replaceCheckbox).toBeTruthy()

    fireEvent.click(replaceCheckbox)
    fireEvent.click(screen.getByText('承認して確定保存'))

    await waitFor(() => {
      expect(approveResultDraftMock).toHaveBeenCalled()
    })
    const fd = approveResultDraftMock.mock.calls[0]![1]
    expect(JSON.parse(fd.get('replaceGrades') as string)).toEqual(['C'])
    expect(JSON.parse(fd.get('selectedClasses') as string)).toEqual([0, 1, 2])
  })
})
