import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SaveTravelRouteState } from './actions'
import type { RouteFormProps } from './RouteForm'

/**
 * travel-report S8 (RouteForm): 既定行の生成・行き/帰り変更時の差し替え・
 * 本人が足した行の保持（AC-13・AC-14）を DOM レベルで検証する。
 *
 * `@testing-library/jest-dom` は未導入のため、素の DOM（`.textContent` 等）で書く。
 */

const saveTravelRouteActionMock = vi.fn<
  (prev: SaveTravelRouteState, fd: FormData) => Promise<SaveTravelRouteState>
>()

vi.mock('./actions', () => ({
  saveTravelRouteAction: (prev: SaveTravelRouteState, fd: FormData) =>
    saveTravelRouteActionMock(prev, fd),
}))

const { RouteForm } = await import('./RouteForm')

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

const baseProps: RouteFormProps = {
  eventId: 1,
  entryGroupId: 10,
  eventTitle: '十和田大会 A・B級',
  unit: { startDate: '2026-10-10', endDate: '2026-10-11', dates: ['2026-10-10', '2026-10-11'] },
  targetUserId: 'u1',
  targetName: '藤野 美咲',
  isProxy: false,
  attendanceDates: ['2026-10-10'],
  attendanceGrade: 'A',
  destinationLabel: '十和田',
  saved: null,
  profile: { facultyKind: 'undergraduate', faculty: '工学部', schoolYear: '3年', phone: '090-0000-0003' },
}

async function submittedLegs(container: HTMLElement): Promise<{ date: string; from: string; to: string }[]> {
  await waitFor(() => expect(saveTravelRouteActionMock).toHaveBeenCalledTimes(1))
  const fd = saveTravelRouteActionMock.mock.calls[0]?.[1]
  return JSON.parse(String(fd?.get('legs') ?? '[]'))
}

describe('RouteForm', () => {
  beforeEach(() => {
    saveTravelRouteActionMock.mockReset()
    saveTravelRouteActionMock.mockResolvedValue({})
  })

  it('AC-13: 既定行が本人の出場日基準（前日/翌日）で入っている', async () => {
    const { container } = render(<RouteForm {...baseProps} />)
    submitForm(container)
    const legs = await submittedLegs(container)
    expect(legs).toEqual([
      { date: '2026-10-09', from: '札幌', to: '十和田' },
      { date: '2026-10-11', from: '十和田', to: '札幌' },
    ])
  })

  it('AC-14: 行き「帰省先から出場」で往路の既定行が消え、出場チップの文言が変わる', async () => {
    const { container } = render(<RouteForm {...baseProps} />)
    fireEvent.click(screen.getByRole('radio', { name: '帰省先から出場' }))

    expect(container.textContent).toContain('大会出場（帰省先から出場）')

    submitForm(container)
    const legs = await submittedLegs(container)
    // 往路（10/9 札幌→十和田）は消え、復路（10/11 十和田→札幌）だけ残る。
    expect(legs).toEqual([{ date: '2026-10-11', from: '十和田', to: '札幌' }])
  })

  it('AC-14: 帰り「そのまま帰省」で復路の既定行が消える', async () => {
    const { container } = render(<RouteForm {...baseProps} />)
    fireEvent.click(screen.getByRole('radio', { name: 'そのまま帰省' }))

    submitForm(container)
    const legs = await submittedLegs(container)
    expect(legs).toEqual([{ date: '2026-10-09', from: '札幌', to: '十和田' }])
  })

  it('AC-14: 本人が足した行（出場日と同日の移動）は行き/帰りの選択を変えても残る', async () => {
    const { container } = render(<RouteForm {...baseProps} />)

    // 出場日（10/10）の行に移動を1本足す（design-mock 5枚目: 十和田→苫小牧）。
    const addButtons = screen.getAllByText('＋ 移動を足す')
    // 日の並びは 10/9, 10/10, 10/11 なので2番目が出場日の行。
    fireEvent.click(addButtons[1]!)
    const fromInputs = screen.getAllByLabelText('2026-10-10 出発地')
    const toInputs = screen.getAllByLabelText('2026-10-10 到着地')
    fireEvent.change(fromInputs[0]!, { target: { value: '十和田' } })
    fireEvent.change(toInputs[0]!, { target: { value: '苫小牧' } })

    // 行きを「その他」に変えて既定行を差し替える（「その他」は行き/帰り共通ラベルなので
    // 先に描画される行き側の radio を取る）。
    const departureOther = screen.getAllByRole('radio', { name: 'その他' })[0]!
    fireEvent.click(departureOther)

    submitForm(container)
    const legs = await submittedLegs(container)
    expect(legs).toContainEqual({ date: '2026-10-10', from: '十和田', to: '苫小牧' })
  })

  it('375px 想定: 移動行の各入力が40%幅クラスを持つ（横スクロールしない設計）', () => {
    render(<RouteForm {...baseProps} />)
    const fromInput = screen.getAllByLabelText('2026-10-09 出発地')[0] as HTMLInputElement
    expect(fromInput.className).toContain('basis-[40%]')
  })

  it('代理入力: 見出しに対象者名と朱の注記が付き、ボタンは通常と同じ文言', () => {
    render(<RouteForm {...baseProps} isProxy targetName="石狩 蓮" saved={null} />)
    expect(screen.getByText('（代理入力）')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この行程で保存' })).toBeTruthy()
  })

  it('入力済み: ボタン文言が「修正を保存」になる', () => {
    render(
      <RouteForm
        {...baseProps}
        saved={{
          departureKind: 'sapporo',
          departurePlace: null,
          returnKind: 'sapporo',
          returnPlace: null,
          legs: [],
          savedAtIso: '2026-09-06T04:20:00.000Z',
        }}
      />,
    )
    expect(screen.getByRole('button', { name: '修正を保存' })).toBeTruthy()
  })

  it('design-mock②: 行き/帰りとも帰省なら表示日は単位の開催日のみ（出場しない日も並び「移動なし」）', () => {
    const { container } = render(
      <RouteForm
        {...baseProps}
        attendanceDates={['2026-10-11']}
        saved={{
          departureKind: 'hometown',
          departurePlace: null,
          returnKind: 'hometown',
          returnPlace: null,
          legs: [],
          savedAtIso: '2026-09-06T04:20:00.000Z',
        }}
      />,
    )
    // 単位は 10/10・10/11 の2日だけ（往路・復路の既定行が無いので前日/翌日は増えない）。
    expect(screen.getAllByText('移動なし')).toHaveLength(1)
    expect(container.textContent).toContain('大会出場（帰省先から出場）')
  })

  it('プロフィール欠落時は表を開いた状態で始まる（電話なし）', () => {
    render(
      <RouteForm
        {...baseProps}
        profile={{ facultyKind: 'undergraduate', faculty: '理学部', schoolYear: '1年', phone: null }}
      />,
    )
    expect(screen.getByLabelText('学部等名')).toBeTruthy()
    expect(screen.getByText('遠征届の名簿に載せるため、電話番号が必要です')).toBeTruthy()
  })
})
