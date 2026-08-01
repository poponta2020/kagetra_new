import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RosterFileAdoptSheet } from './RosterFileAdoptSheet'
import { adoptRosterFile, releaseRosterFile } from '../actions'
import type { RosterAdoptGroup } from '../roster-adopt-utils'

// roster-file-adoption: Server Action と router は副作用なので mock。
// 引数の並び (attachmentId, entryGroupId, rosterType, grades, publishedAt) を
// fireEvent で組み立てて検証する。候補の絞り込み規則そのものの網羅は
// roster-adopt-utils.test.ts が持つので、ここは「純関数の結果が UI に出て、
// 選択が正しい引数になる」ことに絞る。
vi.mock('../actions', () => ({
  adoptRosterFile: vi.fn(),
  releaseRosterFile: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const adoptRosterFileMock = vi.mocked(adoptRosterFile)
const releaseRosterFileMock = vi.mocked(releaseRosterFile)

/** 申込済み・未採用・A/B級のグループ（既定フィルタで統一・級別どちらにも出る）。 */
const appliedGroup: RosterAdoptGroup = {
  groupId: 42,
  displayName: '春季AB',
  days: [
    { eventDate: '2030-05-01', entryStatus: 'applied', eligibleGrades: ['A'] },
    { eventDate: '2030-05-02', entryStatus: 'applied', eligibleGrades: ['B'] },
  ],
  files: [],
}

/** 申込前のグループ（既定では隠れ、「すべて表示」でだけ出る）。 */
const notAppliedGroup: RosterAdoptGroup = {
  groupId: 77,
  displayName: '秋季C',
  days: [{ eventDate: '2030-09-01', entryStatus: 'not_applied', eligibleGrades: ['C'] }],
  files: [],
}

const groups = [appliedGroup, notAppliedGroup]

function openSheet(items: RosterAdoptGroup[] = groups) {
  render(
    <RosterFileAdoptSheet
      attachmentId={7}
      attachmentFilename="roster.xlsx"
      groups={items}
      adoption={null}
    />,
  )
  fireEvent.click(screen.getByText('名簿ファイルとして採用'))
}

describe('RosterFileAdoptSheet — 未採用（採用フォーム）', () => {
  beforeEach(() => {
    adoptRosterFileMock.mockReset()
    adoptRosterFileMock.mockResolvedValue({ ok: true })
  })

  it('グループ統一で採用すると grades=null で adoptRosterFile に渡る', async () => {
    openSheet()
    // 種別の切替は選択を捨てる（候補の母集団が変わるため）。種別 → 対象の順で選ぶ。
    fireEvent.click(screen.getByLabelText('確定名簿'))
    fireEvent.click(screen.getByLabelText('春季AB'))
    const dateInput = screen.getByDisplayValue('') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2030-07-01' } })
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 42, 'confirmed', null, '2030-07-01')
    })
  })

  it('発表日を入力しなければ 5 番目の引数は null（種別は既定の申込者名簿）', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText('春季AB'))
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 42, 'applicant', null, null)
    })
  })

  it('級別モードでは同一グループの複数級を選んで送信できる', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText('級別名簿'))
    fireEvent.click(screen.getByLabelText('春季AB A級'))
    fireEvent.click(screen.getByLabelText('春季AB B級'))
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 42, 'applicant', ['A', 'B'], null)
    })
  })

  it('級別で別グループの級を触ると選択がそちらへ移る（グループを跨いで選べない）', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText('級別名簿'))
    fireEvent.click(screen.getByLabelText('すべて表示'))
    fireEvent.click(screen.getByLabelText('春季AB A級'))
    fireEvent.click(screen.getByLabelText('秋季C C級'))

    expect((screen.getByLabelText('春季AB A級') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('秋季C C級') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByText('採用する'))
    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 77, 'applicant', ['C'], null)
    })
  })

  it('既定候補は申込済みのグループだけ。「すべて表示」で申込前のグループも出る', () => {
    openSheet()
    expect(screen.getByLabelText('春季AB')).toBeTruthy()
    expect(screen.queryByLabelText('秋季C')).toBeNull()

    fireEvent.click(screen.getByLabelText('すべて表示'))
    expect(screen.getByLabelText('秋季C')).toBeTruthy()
  })

  it('種別を切り替えると候補が種別ごとの採用状況で切り替わる', () => {
    // 申込者名簿だけ採用済みのグループ: applicant では隠れ、confirmed では出る（AC-16）。
    openSheet([
      {
        ...appliedGroup,
        files: [{ rosterType: 'applicant', grades: null }],
      },
    ])
    expect(screen.queryByLabelText('春季AB')).toBeNull()

    fireEvent.click(screen.getByLabelText('確定名簿'))
    expect(screen.getByLabelText('春季AB')).toBeTruthy()
  })

  it('種別を切り替えると前の選択は捨てられる', () => {
    openSheet()
    fireEvent.click(screen.getByLabelText('春季AB'))
    expect((screen.getByLabelText('春季AB') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByLabelText('確定名簿'))
    expect((screen.getByLabelText('春季AB') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('採用する').closest('button')?.disabled).toBe(true)
  })

  it('対象未選択では「採用する」が disabled', () => {
    openSheet()
    expect(screen.getByText('採用する').closest('button')?.disabled).toBe(true)
  })

  it('級別で級を1つも選んでいないと「採用する」は disabled', () => {
    openSheet()
    fireEvent.click(screen.getByLabelText('級別名簿'))
    fireEvent.click(screen.getByLabelText('春季AB A級'))
    fireEvent.click(screen.getByLabelText('春季AB A級'))

    expect(screen.getByText('採用する').closest('button')?.disabled).toBe(true)
  })

  it('候補が 0 件なら「候補がありません」を出す', () => {
    openSheet([notAppliedGroup])
    expect(screen.getByText('候補がありません')).toBeTruthy()
  })

  it('採用に失敗するとエラーメッセージを表示し、シートは閉じない', async () => {
    adoptRosterFileMock.mockResolvedValue({ ok: false, error: 'この添付は既に採用されています' })
    openSheet()
    fireEvent.click(screen.getByLabelText('春季AB'))
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(screen.getByText('この添付は既に採用されています')).toBeTruthy()
    })
    // シートは開いたまま（対象選択欄が引き続き見える）。
    expect(screen.getByText('対象グループ')).toBeTruthy()
  })
})

describe('RosterFileAdoptSheet — 採用済み', () => {
  beforeEach(() => {
    releaseRosterFileMock.mockReset()
    releaseRosterFileMock.mockResolvedValue({ ok: true })
  })

  it('種別・対象大会名を表示し、「採用を解除」で releaseRosterFile(id) を呼ぶ', async () => {
    render(
      <RosterFileAdoptSheet
        attachmentId={7}
        attachmentFilename="roster.xlsx"
        groups={groups}
        adoption={{ id: 99, rosterType: 'confirmed', grades: null, eventTitles: ['対象大会X'] }}
      />,
    )

    expect(screen.getByText('確定名簿')).toBeTruthy()
    expect(screen.getByText(/対象大会X/)).toBeTruthy()

    fireEvent.click(screen.getByText('採用を解除'))

    await waitFor(() => {
      expect(releaseRosterFileMock).toHaveBeenCalledWith(99)
    })
  })

  it('級別採用には級ラベルが出る（AC-18）。グループ統一（grades=null）には出ない', () => {
    const { rerender } = render(
      <RosterFileAdoptSheet
        attachmentId={7}
        attachmentFilename="roster.xlsx"
        groups={groups}
        adoption={{
          id: 99,
          rosterType: 'applicant',
          grades: ['B', 'A'],
          eventTitles: ['対象大会X'],
        }}
      />,
    )
    expect(screen.getByText('A・B級')).toBeTruthy()

    rerender(
      <RosterFileAdoptSheet
        attachmentId={7}
        attachmentFilename="roster.xlsx"
        groups={groups}
        adoption={{ id: 99, rosterType: 'applicant', grades: null, eventTitles: ['対象大会X'] }}
      />,
    )
    expect(screen.queryByText(/級$/)).toBeNull()
  })
})
