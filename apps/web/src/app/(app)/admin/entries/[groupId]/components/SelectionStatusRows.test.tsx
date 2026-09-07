import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  SelectionStatusRows,
  type SelectionStatusRowsProps,
} from './SelectionStatusRows'

/**
 * S5 名簿セクション「確定状況」（requirements R3・AC-8/AC-9）。
 * 遠征届の対象者判定・保存 Action の認可はここでは扱わない（Server Action 側の
 * テストが担当）。ここは表示・編集・保存呼び出しの責務だけを検証する。
 */

const baseProps = (over: Partial<SelectionStatusRowsProps> = {}): SelectionStatusRowsProps => ({
  entryGroupId: 42,
  rows: [
    { userId: 'u-1', name: '北海 太郎', grade: 'A', isGuest: false, status: 'confirmed' },
    { userId: 'u-2', name: '函館 大地', grade: 'B', isGuest: true, status: 'waitlisted' },
  ],
  saveAction: vi.fn().mockResolvedValue(undefined),
  resetAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

function openAllDetails(container: HTMLElement) {
  container.querySelectorAll('details').forEach((d) => {
    d.open = true
  })
}

describe('SelectionStatusRows', () => {
  it('対象が0人なら何も描画しない', () => {
    const { container } = render(<SelectionStatusRows {...baseProps({ rows: [] })} />)
    // jest-dom は導入していないので素の DOM で見る（リポジトリの既存流儀）。
    expect(container.innerHTML).toBe('')
  })

  it('1人1行＋3択セグメントで、現在の確定状況が選択済みになっている', () => {
    const { container } = render(<SelectionStatusRows {...baseProps()} />)
    openAllDetails(container)

    const taroGroup = screen.getByRole('radiogroup', { name: '北海 太郎の確定状況' })
    expect(
      within(taroGroup)
        .getByRole('radio', { name: '北海 太郎を確定にする' })
        .getAttribute('aria-checked'),
    ).toBe('true')
    const daichiGroup = screen.getByRole('radiogroup', { name: '函館 大地の確定状況' })
    expect(
      within(daichiGroup)
        .getByRole('radio', { name: '函館 大地をキャンセル待ちにする' })
        .getAttribute('aria-checked'),
    ).toBe('true')

    // ゲストは「ゲスト」表示が付く。
    expect(screen.getByText('ゲスト')).not.toBeNull()
    // 集計サマリ（確定1・キャンセル待ち1・不参加0）。
    expect(screen.getByText('確定 1 ・ キャンセル待ち 1 ・ 不参加 0')).not.toBeNull()
  })

  it('セグメントを切り替えてから保存すると、全行ぶんの最新状態が saveAction へ渡る（AC-8）', async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<SelectionStatusRows {...baseProps({ saveAction })} />)
    openAllDetails(container)

    fireEvent.click(screen.getByRole('radio', { name: '北海 太郎をキャンセル待ちにする' }))
    fireEvent.click(screen.getByRole('button', { name: '確定状況を保存' }))

    await vi.waitFor(() => expect(saveAction).toHaveBeenCalled())
    expect(saveAction).toHaveBeenCalledWith(42, [
      { userId: 'u-1', status: 'waitlisted' },
      { userId: 'u-2', status: 'waitlisted' },
    ])
  })

  it('「取込名簿の結果に戻す」で resetAction が entryGroupId 付きで呼ばれる（R3）', async () => {
    const resetAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<SelectionStatusRows {...baseProps({ resetAction })} />)
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '取込名簿の結果に戻す' }))

    await vi.waitFor(() => expect(resetAction).toHaveBeenCalledWith(42))
  })

  it('保存が失敗するとエラーメッセージを表示する', async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error('対象外の会員が含まれています'))
    const { container } = render(<SelectionStatusRows {...baseProps({ saveAction })} />)
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '確定状況を保存' }))

    expect((await screen.findByRole('alert')).textContent).toContain('対象外の会員が含まれています')
  })
})
