import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  LineBroadcastSection,
  type LineBroadcastSectionProps,
} from './LineBroadcastSection'

const baseProps = (
  over: Partial<LineBroadcastSectionProps> = {},
): LineBroadcastSectionProps => ({
  eventId: 1,
  eventTitle: '第1回大会',
  isAdmin: true,
  binding: null,
  history: [],
  generateInviteCodeAction: vi.fn(),
  revokeBroadcastAction: vi.fn(),
  manualBroadcastAction: vi.fn().mockResolvedValue(undefined),
  setGuidelineAttachmentsAction: vi.fn().mockResolvedValue(undefined),
  resendGuidelinesAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

const linkedBinding = {
  status: 'linked' as const,
  botLabel: 'かるた通知Bot A',
  lineGroupIdTail: 'abcd1234',
  linkedAt: new Date('2026-07-01T10:00:00+09:00'),
  lastBroadcastAt: new Date('2026-07-02T10:00:00+09:00'),
  guidelineCount: 2,
  guidelinesSentAt: new Date('2026-07-03T10:00:00+09:00'),
}

/** `<details>` は既定=閉なので、中身を assert する前に開いておく。 */
function openAllDetails(container: HTMLElement) {
  container.querySelectorAll('details').forEach((d) => {
    d.open = true
  })
}

describe('LineBroadcastSection — AC-13b/AC-28: 非管理者への遮断', () => {
  it('isAdmin=false のとき何も描画しない（linked でも案内文が出ない）', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({ isAdmin: false, binding: linkedBinding })}
      />,
    )
    expect(container.firstChild).toBeNull()
    expect(
      screen.queryByText(/この大会は LINE グループに自動配信されています/),
    ).toBeNull()
  })
})

describe('LineBroadcastSection — 状態別の文言とアクション', () => {
  it('unbound: 説明文＋「LINE 配信を有効化」', () => {
    const { container } = render(
      <LineBroadcastSection {...baseProps({ binding: null })} />,
    )
    openAllDetails(container)
    expect(screen.getByText('未連携')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'LINE 配信を有効化' }),
    ).toBeTruthy()
  })

  it('joined_waiting_code: 説明文＋「招待コードを再発行」「取り消し」＋手動紐付けリンク', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({
          binding: { ...linkedBinding, status: 'joined_waiting_code' },
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.getByText('Bot 入室済み（コード待ち）')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '招待コードを再発行' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '取り消し' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: '/admin/line-channels' }),
    ).toBeTruthy()
  })

  it('linked: 連携状況・配信履歴の行が出て「要綱を再送」「連携解除」が出る', () => {
    const { container } = render(
      <LineBroadcastSection {...baseProps({ binding: linkedBinding })} />,
    )
    openAllDetails(container)
    expect(screen.getByText('配信中')).toBeTruthy()
    expect(screen.getByText('連携状況')).toBeTruthy()
    expect(screen.getByText('かるた通知Bot A')).toBeTruthy()
    expect(screen.getByText(/2件選択済み/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '要綱を再送' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '連携解除' })).toBeTruthy()
    expect(screen.getByText('配信履歴')).toBeTruthy()
  })

  it('guidelineCount=0 のときは「要綱を再送」が出ない', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({
          binding: { ...linkedBinding, guidelineCount: 0, guidelinesSentAt: null },
        })}
      />,
    )
    openAllDetails(container)
    expect(
      screen.queryByRole('button', { name: '要綱を再送' }),
    ).toBeNull()
  })
})

describe('LineBroadcastSection — AC-13c/AC-29: 級別グループ配信の内包', () => {
  const gradeBroadcast = {
    rows: [
      { grade: 'C' as const, sentAt: new Date('2026-07-20T14:40:00+09:00'), linked: true },
      { grade: 'D' as const, sentAt: null, linked: true },
      { grade: 'E' as const, sentAt: null, linked: false },
    ],
    resendAction: vi.fn().mockResolvedValue(undefined),
  }

  it('gradeBroadcast を渡すと LINE 配信トグルの中（外側 details の子孫）に描画される', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, gradeBroadcast })}
      />,
    )
    openAllDetails(container)
    const outer = container.querySelector('details') as HTMLDetailsElement
    expect(screen.getByText('級別グループ配信')).toBeTruthy()
    expect(outer.contains(screen.getByText('級別グループ配信'))).toBe(true)
    expect(screen.getByText('1 / 3 送信済み')).toBeTruthy()
  })

  it('gradeBroadcast を渡さない(undefined)と級別配信が描画されない', () => {
    const { container } = render(
      <LineBroadcastSection {...baseProps({ binding: linkedBinding })} />,
    )
    openAllDetails(container)
    expect(screen.queryByText('級別グループ配信')).toBeNull()
  })

  it('gradeBroadcast が null のときも級別配信が描画されない', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, gradeBroadcast: null })}
      />,
    )
    openAllDetails(container)
    expect(screen.queryByText('級別グループ配信')).toBeNull()
  })
})

describe('LineBroadcastSection — 連携解除の confirm（回帰）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('「連携解除」で window.confirm が呼ばれ、拒否すると action が走らない', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const revokeBroadcastAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, revokeBroadcastAction })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '連携解除' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'LINE 配信の連携を解除します。よろしいですか？',
    )
    expect(revokeBroadcastAction).not.toHaveBeenCalled()
  })

  it('「連携解除」で confirm を承認すると revokeBroadcastAction が呼ばれる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const revokeBroadcastAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({
          eventId: 55,
          binding: linkedBinding,
          revokeBroadcastAction,
        })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '連携解除' }))

    await waitFor(() => {
      expect(revokeBroadcastAction).toHaveBeenCalledWith(55)
    })
  })
})
