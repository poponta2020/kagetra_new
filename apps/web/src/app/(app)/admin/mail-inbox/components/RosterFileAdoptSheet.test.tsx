import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RosterFileAdoptSheet } from './RosterFileAdoptSheet'
import { adoptRosterFile, releaseRosterFile } from '../actions'
import type { LinkableEventOption } from './ExistingEventLinkSheet'

// roster-file-adoption タスク2: Server Action と router は副作用なので mock。
// ExistingEventLinkSheet.test.tsx と同じパターン — 引数の並び (attachmentId,
// eventId, rosterType, publishedAt) を fireEvent で組み立てて検証する。
vi.mock('../actions', () => ({
  adoptRosterFile: vi.fn(),
  releaseRosterFile: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const adoptRosterFileMock = vi.mocked(adoptRosterFile)
const releaseRosterFileMock = vi.mocked(releaseRosterFile)

const events: LinkableEventOption[] = [
  { id: 42, title: '春季大会', eventDate: '2030-05-01', status: 'published' },
]

function openSheet() {
  render(
    <RosterFileAdoptSheet
      attachmentId={7}
      attachmentFilename="roster.xlsx"
      linkableEvents={events}
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

  it('イベント選択・種別・発表日を指定すると adoptRosterFile に正しい順序の引数で渡る', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText(/春季大会/))
    fireEvent.click(screen.getByLabelText('確定名簿'))
    const dateInput = screen.getByDisplayValue('') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2030-07-01' } })
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 42, 'confirmed', '2030-07-01')
    })
  })

  it('発表日を入力しなければ 4 番目の引数は null になる（種別は既定の申込者名簿）', async () => {
    openSheet()
    fireEvent.click(screen.getByLabelText(/春季大会/))
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(adoptRosterFileMock).toHaveBeenCalledWith(7, 42, 'applicant', null)
    })
  })

  it('対象イベント未選択では「採用する」が disabled', () => {
    openSheet()
    expect(screen.getByText('採用する').closest('button')?.disabled).toBe(true)
  })

  it('採用に失敗するとエラーメッセージを表示し、シートは閉じない', async () => {
    adoptRosterFileMock.mockResolvedValue({ ok: false, error: 'この添付は既に採用されています' })
    openSheet()
    fireEvent.click(screen.getByLabelText(/春季大会/))
    fireEvent.click(screen.getByText('採用する'))

    await waitFor(() => {
      expect(screen.getByText('この添付は既に採用されています')).toBeTruthy()
    })
    // シートは開いたまま（対象イベント選択欄が引き続き見える）。
    expect(screen.getByText('対象イベント')).toBeTruthy()
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
        linkableEvents={events}
        adoption={{ id: 99, rosterType: 'confirmed', eventTitles: ['対象大会X'] }}
      />,
    )

    expect(screen.getByText('確定名簿')).toBeTruthy()
    expect(screen.getByText(/対象大会X/)).toBeTruthy()

    fireEvent.click(screen.getByText('採用を解除'))

    await waitFor(() => {
      expect(releaseRosterFileMock).toHaveBeenCalledWith(99)
    })
  })
})
