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

describe('LineBroadcastSection — 級別配信は大会側の連携状態に依存しない', () => {
  // 級別グループ配信は「会員全体への周知」という別系統で、紐付けは大会単位ではなく
  // 常設（spec/notifications.md）。status 分岐の中に入れると、未連携の新規大会で
  // 管理者が級別配信の状況確認・再送に到達できなくなる（機能回帰）。
  const gradeBroadcast = {
    rows: [
      { grade: 'C' as const, sentAt: null, linked: true },
      { grade: 'D' as const, sentAt: null, linked: false },
    ],
    resendAction: vi.fn().mockResolvedValue(undefined),
  }

  it('unbound（binding=null）でも級別グループ配信が描画される', () => {
    const { container } = render(
      <LineBroadcastSection {...baseProps({ binding: null, gradeBroadcast })} />,
    )
    openAllDetails(container)
    expect(screen.getByText('級別グループ配信')).toBeTruthy()
    // 大会側の未連携 UI と併存する。
    expect(screen.getByText('LINE 配信を有効化')).toBeTruthy()
  })

  it('joined_waiting_code でも級別グループ配信が描画される', () => {
    const { container } = render(
      <LineBroadcastSection
        {...baseProps({
          binding: { ...linkedBinding, status: 'joined_waiting_code' as const },
          gradeBroadcast,
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.getByText('級別グループ配信')).toBeTruthy()
    expect(screen.getByText('招待コードを再発行')).toBeTruthy()
  })
})

describe('LineBroadcastSection — 配信履歴 aux の失敗表記', () => {
  const row = (id: number, status: 'sent' | 'partial' | 'failed') => ({
    id,
    status,
    isCorrection: false,
    mailMessageId: id,
    subject: `件名${id}`,
    receivedAt: new Date('2026-07-24T08:50:00+09:00'),
    sentAt: new Date('2026-07-24T09:15:00+09:00'),
    sentTextCount: 1,
    sentImageCount: 0,
    fallbackLinkCount: 0,
    errorMessage: null,
  })

  it('完全失敗のみなら「失敗」と出す（部分失敗と混同させない）', () => {
    render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, history: [row(1, 'failed')] })}
      />,
    )
    expect(screen.getByText('1件 失敗')).toBeTruthy()
    expect(screen.queryByText('1件 部分失敗')).toBeNull()
  })

  it('部分失敗のみなら「部分失敗」と出す', () => {
    render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, history: [row(1, 'partial')] })}
      />,
    )
    expect(screen.getByText('1件 部分失敗')).toBeTruthy()
  })

  it('両方あるなら件数を分けて出す', () => {
    render(
      <LineBroadcastSection
        {...baseProps({
          binding: linkedBinding,
          history: [row(1, 'failed'), row(2, 'partial'), row(3, 'partial')],
        })}
      />,
    )
    expect(screen.getByText('失敗 1件・部分失敗 2件')).toBeTruthy()
  })

  it('成功のみなら aux を出さない', () => {
    render(
      <LineBroadcastSection
        {...baseProps({ binding: linkedBinding, history: [row(1, 'sent')] })}
      />,
    )
    expect(screen.queryByText(/失敗/)).toBeNull()
  })
})
