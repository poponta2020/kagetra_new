import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  EventLifecycleSection,
  type EventLifecycleSectionProps,
} from './EventLifecycleSection'

const baseProps = (
  over: Partial<EventLifecycleSectionProps> = {},
): EventLifecycleSectionProps => ({
  eventId: 1,
  entryStatus: 'not_applied',
  entryAppliedAt: null,
  paymentType: null,
  paymentStatus: 'unpaid',
  paymentPaidAt: null,
  feeJpy: null,
  entryDeadline: null,
  paymentDeadline: null,
  isLineLinked: true,
  setEntryAppliedAction: vi.fn().mockResolvedValue(undefined),
  setEntryNotApplyingAction: vi.fn().mockResolvedValue(undefined),
  setPaymentTypeAction: vi.fn().mockResolvedValue(undefined),
  setPaymentPaidAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

describe('EventLifecycleSection — 申込状態 3 状態化 (entry-overdue-alert)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('not_applied: 「申込済にする」と「申し込まない」の 2 ボタンが出る', () => {
    render(<EventLifecycleSection {...baseProps({ entryStatus: 'not_applied' })} />)
    expect(screen.getByRole('button', { name: '申込済にする' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '申し込まない' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '未申込に戻す' })).toBeNull()
  })

  it('applied: 「未申込に戻す」と「申し込まない」の 2 ボタンが出る', () => {
    render(<EventLifecycleSection {...baseProps({ entryStatus: 'applied' })} />)
    expect(screen.getByRole('button', { name: '未申込に戻す' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '申し込まない' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申込済にする' })).toBeNull()
  })

  it('not_applying: 「未申込に戻す」のみが出る（申込済にする・申し込まないは出ない）', () => {
    render(<EventLifecycleSection {...baseProps({ entryStatus: 'not_applying' })} />)
    expect(screen.getByRole('button', { name: '未申込に戻す' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申込済にする' })).toBeNull()
    expect(screen.queryByRole('button', { name: '申し込まない' })).toBeNull()
  })

  it('「申し込まない」押下で window.confirm が出て、OK なら setEntryNotApplyingAction が eventId 付きで呼ばれる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryNotApplyingAction = vi.fn().mockResolvedValue(undefined)
    render(
      <EventLifecycleSection
        {...baseProps({ eventId: 42, entryStatus: 'not_applied', setEntryNotApplyingAction })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申し込まない' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'この大会は大会申込一覧に表示されなくなります。よろしいですか？',
    )
    await waitFor(() => {
      expect(setEntryNotApplyingAction).toHaveBeenCalledWith(42)
    })
  })

  it('「申し込まない」押下で confirm をキャンセルすると setEntryNotApplyingAction は呼ばれない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const setEntryNotApplyingAction = vi.fn().mockResolvedValue(undefined)
    render(
      <EventLifecycleSection
        {...baseProps({ entryStatus: 'not_applied', setEntryNotApplyingAction })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申し込まない' }))

    expect(setEntryNotApplyingAction).not.toHaveBeenCalled()
  })

  it('「申し込まない」の confirm は isLineLinked=false でも出る（LINE 通知 confirm とは別種）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryNotApplyingAction = vi.fn().mockResolvedValue(undefined)
    render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'applied',
          isLineLinked: false,
          setEntryNotApplyingAction,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申し込まない' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'この大会は大会申込一覧に表示されなくなります。よろしいですか？',
    )
    await waitFor(() => {
      expect(setEntryNotApplyingAction).toHaveBeenCalled()
    })
  })

  it('「未申込に戻す」(not_applying から) は confirm を出さず setEntryAppliedAction(id, false) を呼ぶ', async () => {
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(
      <EventLifecycleSection
        {...baseProps({ eventId: 7, entryStatus: 'not_applying', setEntryAppliedAction })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '未申込に戻す' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(7, false)
    })
  })

  it('「申込済にする」(not_applied から, linked) は既存どおり通知 confirm を出す', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'not_applied',
          isLineLinked: true,
          setEntryAppliedAction,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))

    expect(window.confirm).toHaveBeenCalledWith(
      '参加者の LINE グループに通知が送られます。よろしいですか？',
    )
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(1, true)
    })
  })
})
