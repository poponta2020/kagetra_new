import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  PaymentNoticeSection,
  type PaymentNoticeSectionProps,
} from './PaymentNoticeSection'

/**
 * 振込連絡セクション（line-bot-message-revamp §3.3.2）。
 *
 * ここが守るのは「**人数は編集でき、単価は編集できない**」（AC-13）と、
 * プレビューが送信内容と同じ純関数（`buildPaymentNoticeMessages`）で組まれること。
 * 露出条件は page.tsx / `payment-notice-context` の担当なので、ここでは扱わない。
 */

const baseProps = (
  over: Partial<PaymentNoticeSectionProps> = {},
): PaymentNoticeSectionProps => ({
  groupId: 1,
  rows: [
    { grade: 'A', count: 3, unitJpy: 2500 },
    { grade: 'B', count: 2, unitJpy: 2500 },
  ],
  hasSavedCounts: false,
  paymentDeadline: '2026-07-25',
  paymentInfo: '〇〇銀行 普通 1234567',
  lastSentAt: null,
  lastAttemptedAt: null,
  lastError: null,
  sendAction: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
})

/** `<details>` は既定=閉なので、中身を assert する前に開いておく。 */
function openAllDetails(container: HTMLElement) {
  container.querySelectorAll('details').forEach((d) => {
    d.open = true
  })
}

describe('PaymentNoticeSection', () => {
  it('級ごとの人数だけが入力欄で、単価は入力できない（AC-13）', () => {
    const { container } = render(<PaymentNoticeSection {...baseProps()} />)
    openAllDetails(container)

    // 入力欄は級の数と一致する（= 人数だけ）。
    const inputs = container.querySelectorAll('input')
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input.getAttribute('aria-label')).toMatch(/級の人数$/)
    }
    // 単価はテキストとして出るだけ。
    expect(screen.getAllByText('2,500円')).toHaveLength(2)
  })

  it('プレビューが §3.3.3 の書式で出る', () => {
    const { container } = render(<PaymentNoticeSection {...baseProps()} />)
    openAllDetails(container)

    const preview = container.querySelectorAll('pre')
    expect(preview).toHaveLength(2)
    expect(preview[0]!.textContent).toBe(
      [
        '@会計',
        '7/25(土)までに',
        'A級：2500*3 = 7500円、',
        'B級：2500*2 = 5000円',
        '',
        '計12500円',
        '',
        'を、以下の口座に振り込んでください',
      ].join('\n'),
    )
    // 2通目は支払情報の自由記述（メンションを持たない別メッセージ・AC-8）。
    expect(preview[1]!.textContent).toBe('〇〇銀行 普通 1234567')
  })

  it('人数を直すとプレビューの金額が追随する', () => {
    const { container } = render(<PaymentNoticeSection {...baseProps()} />)
    openAllDetails(container)

    fireEvent.change(screen.getByLabelText('A級の人数'), { target: { value: '1' } })
    const preview = container.querySelectorAll('pre')
    expect(preview[0]!.textContent).toContain('A級：2500*1 = 2500円')
    expect(preview[0]!.textContent).toContain('計7500円')
  })

  it('payment_info が空なら2通目を出さない（AC-17）', () => {
    const { container } = render(
      <PaymentNoticeSection {...baseProps({ paymentInfo: null })} />,
    )
    openAllDetails(container)
    expect(container.querySelectorAll('pre')).toHaveLength(1)
  })

  it('payment_deadline が NULL なら日付行が消える（AC-16）', () => {
    const { container } = render(
      <PaymentNoticeSection {...baseProps({ paymentDeadline: null })} />,
    )
    openAllDetails(container)
    expect(container.querySelectorAll('pre')[0]!.textContent).not.toContain('までに')
  })

  it('人数を全級0にすると送信ボタンが無効になる（AC-18）', () => {
    const { container } = render(
      <PaymentNoticeSection
        {...baseProps({ rows: [{ grade: 'A', count: 0, unitJpy: 2500 }] })}
      />,
    )
    openAllDetails(container)
    expect(
      screen.getByRole('button', { name: '振込連絡を送る' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('人数が全級0名です')
  })

  it('送信済みなら再送ボタンと最終送信日時を出す（§3.3.4）', () => {
    const { container } = render(
      <PaymentNoticeSection
        {...baseProps({ lastSentAt: new Date('2026-07-20T10:00:00+09:00') })}
      />,
    )
    openAllDetails(container)
    expect(
      screen.getByRole('button', { name: '振込連絡を再送する' }).hasAttribute('disabled'),
    ).toBe(false)
    expect(container.textContent).toContain('送信済 7/20 10:00')
  })

  it('再検証で rows の人数が変わったら counts を作り直す（対象外の人数で送らない）', async () => {
    const sendAction = vi.fn().mockResolvedValue({ ok: true })
    const { container, rerender } = render(
      <PaymentNoticeSection
        {...baseProps({ rows: [{ grade: 'A', count: 2, unitJpy: 2500 }], sendAction })}
      />,
    )
    openAllDetails(container)

    // Server Component の再検証で rows が新しい集計（1名）へ更新される。
    rerender(
      <PaymentNoticeSection
        {...baseProps({ rows: [{ grade: 'A', count: 1, unitJpy: 2500 }], sendAction })}
      />,
    )
    openAllDetails(container)

    const preview = container.querySelectorAll('pre')
    expect(preview[0]!.textContent).toContain('A級：2500*1 = 2500円')

    fireEvent.click(screen.getByRole('button', { name: '振込連絡を送る' }))
    await vi.waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1))
    expect(sendAction).toHaveBeenCalledWith(1, { A: 1 })
  })

  it('rows が変わらない再レンダーでは、ユーザーが入力した人数を巻き戻さない', () => {
    const { container, rerender } = render(<PaymentNoticeSection {...baseProps()} />)
    openAllDetails(container)

    fireEvent.change(screen.getByLabelText('A級の人数'), { target: { value: '1' } })

    // rows の内容は変わらない再レンダー（例: 親の他の state 更新による再描画）。
    rerender(<PaymentNoticeSection {...baseProps()} />)
    openAllDetails(container)

    const input = screen.getByLabelText('A級の人数') as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('送信ボタンで人数がそのまま Server Action へ渡る', async () => {
    const sendAction = vi.fn().mockResolvedValue({ ok: true })
    const { container } = render(
      <PaymentNoticeSection {...baseProps({ groupId: 42, sendAction })} />,
    )
    openAllDetails(container)

    fireEvent.change(screen.getByLabelText('B級の人数'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '振込連絡を送る' }))
    await vi.waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1))
    expect(sendAction).toHaveBeenCalledWith(42, { A: 3, B: 5 })
  })
  it('送信に失敗していたら試行日時つきで出す（AC-45）', () => {
    const { container } = render(
      <PaymentNoticeSection
        {...baseProps({
          lastSentAt: null,
          lastAttemptedAt: new Date('2026-07-21T02:00:00Z'),
          lastError: 'LINE 送信に失敗しました: 500',
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.getByRole('alert').textContent).toContain('送信に失敗しました')
    expect(screen.getByRole('alert').textContent).toContain('LINE 送信に失敗しました: 500')
  })

  it('送信に成功していれば失敗表示は出ない（AC-45b）', () => {
    // `last_error` は成功時に NULL へ戻る。試行日時は成功時にも進むので、
    // 表示の判断は `last_error` の有無で行う。
    const { container } = render(
      <PaymentNoticeSection
        {...baseProps({
          lastSentAt: new Date('2026-07-21T02:00:00Z'),
          lastAttemptedAt: new Date('2026-07-21T02:00:00Z'),
          lastError: null,
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.queryByText(/送信に失敗しました/)).toBeNull()
    expect(screen.getByText(/送信済/)).toBeTruthy()
  })
  it('成功後の再送が失敗したら「送信済」ではなく「送信失敗」を出す（Codex R1 blocker）', async () => {
    // last_error は成功でクリアされるが、last_sent_at は過去の成功のまま残る。
    // ヘッダーが「送信済」のままだと直近の再送結果を誤認して再送を見送りかねない。
    const { container } = render(
      <PaymentNoticeSection
        {...baseProps({
          lastSentAt: new Date('2026-07-20T01:00:00Z'),
          lastAttemptedAt: new Date('2026-07-21T02:00:00Z'),
          lastError: 'LINE 送信に失敗しました: 500',
        })}
      />,
    )
    openAllDetails(container)
    // ヘッダー（aux）は失敗を出し、「送信済」ラベルは出さない。
    expect(container.textContent).toContain('送信失敗')
    expect(container.textContent).not.toContain('送信済 ')
    // 過去の成功は「最終成功」として別に残す。
    expect(container.textContent).toContain('最終成功')
  })
})
