import { describe, it, expect, vi } from 'vitest'
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
  setGuidelineAttachmentsAction: vi.fn().mockResolvedValue(undefined),
  resendGuidelinesAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

describe('LineBroadcastSection — 要綱の状態表示・再送', () => {
  it('linked binding で「要綱」行に件数と最終送信日時が出る／「要綱を再送」ボタンが出る', () => {
    render(
      <LineBroadcastSection
        {...baseProps({
          binding: {
            status: 'linked',
            botLabel: 'かるた通知Bot A',
            lineGroupIdTail: 'abcd1234',
            linkedAt: new Date('2026-07-01T10:00:00+09:00'),
            lastBroadcastAt: new Date('2026-07-02T10:00:00+09:00'),
            guidelineCount: 2,
            guidelinesSentAt: new Date('2026-07-03T10:00:00+09:00'),
          },
        })}
      />,
    )

    expect(screen.getByText('要綱')).toBeTruthy()
    expect(screen.getByText(/2件選択済み/)).toBeTruthy()
    expect(screen.getByText(/最終送信/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '要綱を再送' })).toBeTruthy()
  })

  it('「要綱を再送」押下で resendGuidelinesAction が eventId 付きで呼ばれる', async () => {
    const resendGuidelinesAction = vi.fn().mockResolvedValue(undefined)
    render(
      <LineBroadcastSection
        {...baseProps({
          eventId: 99,
          resendGuidelinesAction,
          binding: {
            status: 'linked',
            botLabel: 'かるた通知Bot A',
            lineGroupIdTail: 'abcd1234',
            linkedAt: new Date('2026-07-01T10:00:00+09:00'),
            lastBroadcastAt: null,
            guidelineCount: 1,
            guidelinesSentAt: null,
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '要綱を再送' }))

    await waitFor(() => {
      expect(resendGuidelinesAction).toHaveBeenCalledWith(99)
    })
  })

  it('guidelineCount=0 のときは「要綱を再送」ボタンが出ない', () => {
    render(
      <LineBroadcastSection
        {...baseProps({
          binding: {
            status: 'linked',
            botLabel: 'かるた通知Bot A',
            lineGroupIdTail: 'abcd1234',
            linkedAt: new Date('2026-07-01T10:00:00+09:00'),
            lastBroadcastAt: null,
            guidelineCount: 0,
            guidelinesSentAt: null,
          },
        })}
      />,
    )

    expect(screen.getByText(/0件選択済み/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: '要綱を再送' }),
    ).toBeNull()
  })
})
