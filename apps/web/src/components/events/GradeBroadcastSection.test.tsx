import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  GradeBroadcastSection,
  type GradeBroadcastSectionProps,
} from './GradeBroadcastSection'

const baseProps = (
  over: Partial<GradeBroadcastSectionProps> = {},
): GradeBroadcastSectionProps => ({
  eventId: 1,
  rows: [
    { grade: 'C', sentAt: new Date('2026-07-20T14:40:00+09:00'), linked: true },
    { grade: 'D', sentAt: null, linked: true },
    { grade: 'E', sentAt: null, linked: false },
  ],
  resendAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

/** `<details>` は既定=閉なので、中身を assert する前に開いておく。 */
function openAllDetails(container: HTMLElement) {
  container.querySelectorAll('details').forEach((d) => {
    d.open = true
  })
}

describe('GradeBroadcastSection', () => {
  it('summary: 送信済み件数と未紐付けの aux が出る', () => {
    render(<GradeBroadcastSection {...baseProps()} />)
    expect(screen.getByText('級別グループ配信')).toBeTruthy()
    expect(screen.getByText('1 / 3 送信済み')).toBeTruthy()
    expect(screen.getByText('E級 未紐付け')).toBeTruthy()
  })

  it('未紐付けが複数のときは件数表示になる', () => {
    render(
      <GradeBroadcastSection
        {...baseProps({
          rows: [
            { grade: 'C', sentAt: null, linked: false },
            { grade: 'D', sentAt: null, linked: false },
          ],
        })}
      />,
    )
    expect(screen.getByText('2級 未紐付け')).toBeTruthy()
  })

  it('未紐付けが無ければ aux が出ない', () => {
    render(
      <GradeBroadcastSection
        {...baseProps({
          rows: [
            { grade: 'C', sentAt: new Date('2026-07-20T14:40:00+09:00'), linked: true },
            { grade: 'D', sentAt: null, linked: true },
          ],
        })}
      />,
    )
    expect(screen.queryByText(/未紐付け/)).toBeNull()
  })

  it('各級の表示: 送信済み/未送信/未紐付け', () => {
    const { container } = render(<GradeBroadcastSection {...baseProps()} />)
    openAllDetails(container)
    expect(screen.getByText('送信済み 7/20 14:40')).toBeTruthy()
    expect(screen.getByText('未送信')).toBeTruthy()
    expect(screen.getByText('未紐付け')).toBeTruthy()
  })

  it('未送信ゼロで配信ボタンが disabled', () => {
    const { container } = render(
      <GradeBroadcastSection
        {...baseProps({
          rows: [
            { grade: 'C', sentAt: new Date('2026-07-20T14:40:00+09:00'), linked: true },
          ],
        })}
      />,
    )
    openAllDetails(container)
    const btn = screen.getByRole('button', {
      name: '未送信の級へ配信',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('未送信が残っていれば配信ボタンは有効で resendAction を呼ぶ', async () => {
    const resendAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <GradeBroadcastSection {...baseProps({ eventId: 9, resendAction })} />,
    )
    openAllDetails(container)

    const btn = screen.getByRole('button', {
      name: '未送信の級へ配信',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)

    await waitFor(() => {
      expect(resendAction).toHaveBeenCalledWith(9)
    })
  })
})
