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
  paymentType: null,
  paymentStatus: 'unpaid',
  feeJpy: null,
  entryDeadline: null,
  paymentDeadline: null,
  paymentDeadlineKind: 'unspecified',
  entryMethod: null,
  paymentMethod: null,
  paymentInfo: null,
  isLineLinked: true,
  setEntryAppliedAction: vi.fn().mockResolvedValue(undefined),
  setEntryNotApplyingAction: vi.fn().mockResolvedValue(undefined),
  setPaymentTypeAction: vi.fn().mockResolvedValue(undefined),
  setPaymentPaidAction: vi.fn().mockResolvedValue(undefined),
  ...over,
})

/** `<details>` は既定=閉なので、中身を assert する前に開いておく。 */
function openAllDetails(container: HTMLElement) {
  container.querySelectorAll('details').forEach((d) => {
    d.open = true
  })
}

describe('EventLifecycleSection — AC-12: 「申し込まない」の表示条件', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('not_applied のときだけ「申し込まない」が出る', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryStatus: 'not_applied' })} />,
    )
    openAllDetails(container)
    expect(screen.getByRole('button', { name: '申し込まない' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '申込済にする' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '未申込に戻す' })).toBeNull()
  })

  it('applied のときは「申し込まない」が出ない（未申込に戻すのみ）', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryStatus: 'applied' })} />,
    )
    openAllDetails(container)
    expect(screen.queryByRole('button', { name: '申し込まない' })).toBeNull()
    expect(screen.getByRole('button', { name: '未申込に戻す' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申込済にする' })).toBeNull()
  })

  it('not_applying のときは「申し込まない」が出ない（未申込に戻すのみ）', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryStatus: 'not_applying' })} />,
    )
    openAllDetails(container)
    expect(screen.queryByRole('button', { name: '申し込まない' })).toBeNull()
    expect(screen.getByRole('button', { name: '未申込に戻す' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申込済にする' })).toBeNull()
  })
})

describe('EventLifecycleSection — summary の value/tone', () => {
  it('申込状態: applied=申込済 / not_applied=未申込 / not_applying=申込なし', () => {
    const { rerender } = render(
      <EventLifecycleSection {...baseProps({ entryStatus: 'applied' })} />,
    )
    expect(screen.getByText('申込済')).toBeTruthy()
    rerender(<EventLifecycleSection {...baseProps({ entryStatus: 'not_applied' })} />)
    expect(screen.getByText('未申込')).toBeTruthy()
    rerender(<EventLifecycleSection {...baseProps({ entryStatus: 'not_applying' })} />)
    expect(screen.getByText('申込なし')).toBeTruthy()
  })

  it('支払状態: advance&paid=支払済 / advance&unpaid=未払 / onsite=現地払い / null=未設定', () => {
    // 「現地払い」「未設定」は支払いタイプの <select> の option にも同じ文字列で
    // 現れるため、screen.getByText では複数マッチになる。summary（2つ目の
    // <details> = 支払状態）のテキストに絞って検証する。
    function paymentSummaryText(container: HTMLElement): string {
      const details = container.querySelectorAll('details')
      return details[1]?.querySelector('summary')?.textContent ?? ''
    }

    const { container, rerender } = render(
      <EventLifecycleSection
        {...baseProps({ paymentType: 'advance', paymentStatus: 'paid' })}
      />,
    )
    expect(paymentSummaryText(container)).toContain('支払済')
    rerender(
      <EventLifecycleSection
        {...baseProps({ paymentType: 'advance', paymentStatus: 'unpaid' })}
      />,
    )
    expect(paymentSummaryText(container)).toContain('未払')
    rerender(<EventLifecycleSection {...baseProps({ paymentType: 'onsite' })} />)
    expect(paymentSummaryText(container)).toContain('現地払い')
    rerender(<EventLifecycleSection {...baseProps({ paymentType: null })} />)
    expect(paymentSummaryText(container)).toContain('未設定')
  })
})

describe('EventLifecycleSection — AC-11: 支払トグル内のフィールド', () => {
  it('参加費・支払締切・支払方法・振込先が表示される', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          feeJpy: 2000,
          paymentDeadline: '2026-08-20',
          paymentMethod: '事前振込（会の口座へ）',
          paymentInfo: 'ゆうちょ銀行 一二三支店\n普通 1234567 ホクダイカルタカイ',
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.getByText('参加費')).toBeTruthy()
    expect(screen.getByText('2,000円')).toBeTruthy()
    expect(screen.getByText('支払締切')).toBeTruthy()
    expect(screen.getByText('8/20(木)')).toBeTruthy()
    expect(screen.getByText('支払方法')).toBeTruthy()
    expect(screen.getByText('事前振込（会の口座へ）')).toBeTruthy()
    expect(screen.getByText('振込先')).toBeTruthy()
    expect(
      screen.getByText(/ゆうちょ銀行 一二三支店/),
    ).toBeTruthy()
  })

  it('feeJpy/paymentMethod/paymentInfo が null の行は出ない', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          paymentType: 'advance',
          paymentStatus: 'unpaid',
          feeJpy: null,
          paymentDeadline: null,
          paymentMethod: null,
          paymentInfo: null,
        })}
      />,
    )
    openAllDetails(container)
    expect(screen.queryByText('参加費')).toBeNull()
    expect(screen.queryByText('支払締切')).toBeNull()
    expect(screen.queryByText('支払方法')).toBeNull()
    expect(screen.queryByText('振込先')).toBeNull()
  })

  // mail-ai-extract-refinements タスク12 (§3.2.7 / AC-44): 振込締切の状態を日本語で表示する。
  describe('AC-44: 振込締切の状態表示', () => {
    it('paymentDeadline が null で paymentDeadlineKind=later_notice なら「支払締切: 後日連絡」の行が出る', () => {
      const { container } = render(
        <EventLifecycleSection
          {...baseProps({
            paymentDeadline: null,
            paymentDeadlineKind: 'later_notice',
          })}
        />,
      )
      openAllDetails(container)
      expect(screen.getByText('支払締切')).toBeTruthy()
      expect(screen.getByText('後日連絡')).toBeTruthy()
    })

    it('paymentDeadline が null で paymentDeadlineKind=unspecified なら行を出さない（情報が無いだけ）', () => {
      const { container } = render(
        <EventLifecycleSection
          {...baseProps({
            paymentDeadline: null,
            paymentDeadlineKind: 'unspecified',
          })}
        />,
      )
      openAllDetails(container)
      expect(screen.queryByText('支払締切')).toBeNull()
    })

    it('paymentDeadline に日付があれば paymentDeadlineKind に関わらず日付を表示する（fixed の回帰）', () => {
      const { container } = render(
        <EventLifecycleSection
          {...baseProps({
            paymentDeadline: '2026-08-20',
            paymentDeadlineKind: 'fixed',
          })}
        />,
      )
      openAllDetails(container)
      expect(screen.getByText('支払締切')).toBeTruthy()
      expect(screen.getByText('8/20(木)')).toBeTruthy()
      expect(screen.queryByText('後日連絡')).toBeNull()
    })
  })

  it('entryMethod が null のとき申込方法の行が出ない', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryMethod: null })} />,
    )
    openAllDetails(container)
    expect(screen.queryByText('申込方法')).toBeNull()
  })

  it('entryMethod がある場合は申込方法の行が出る', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ entryMethod: '会でとりまとめて申込' })}
      />,
    )
    openAllDetails(container)
    expect(screen.getByText('申込方法')).toBeTruthy()
    expect(screen.getByText('会でとりまとめて申込')).toBeTruthy()
  })

  it('entryDeadline が null のとき「未定」と表示される', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryDeadline: null })} />,
    )
    openAllDetails(container)
    expect(screen.getByText('未定')).toBeTruthy()
  })
})

describe('EventLifecycleSection — AC-13b: 読み取りピル・注記の廃止', () => {
  it('LifecycleStatusBadge 由来の読み取りピル（未払等）は描画されない', () => {
    render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'applied',
          paymentType: 'advance',
          paymentStatus: 'unpaid',
        })}
      />,
    )
    // Pill はロール button ではなく、開いていない details の外に表示されない。
    // summary の value（未払）以外に重複した「未払」ピルが無いことを確認する。
    expect(screen.getAllByText('未払')).toHaveLength(1)
  })

  it('申込日時・支払日時が表示されない', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ entryStatus: 'applied', paymentStatus: 'paid' })}
      />,
    )
    openAllDetails(container)
    expect(screen.queryByText(/申込日時/)).toBeNull()
    expect(screen.queryByText(/支払日時/)).toBeNull()
  })

  it('LINE グループ未紐付けの注記が表示されない', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ isLineLinked: false })} />,
    )
    openAllDetails(container)
    expect(screen.queryByText(/LINE グループ未紐付け/)).toBeNull()
  })
})

describe('EventLifecycleSection — AC-27 回帰: 状態遷移と confirm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('「申し込まない」押下で window.confirm が出て、OK なら setEntryNotApplyingAction が eventId 付きで呼ばれる', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryNotApplyingAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ eventId: 42, entryStatus: 'not_applied', setEntryNotApplyingAction })}
      />,
    )
    openAllDetails(container)

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
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ entryStatus: 'not_applied', setEntryNotApplyingAction })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '申し込まない' }))

    expect(setEntryNotApplyingAction).not.toHaveBeenCalled()
  })

  it('「未申込に戻す」(applied から) は通知 confirm を出さず setEntryAppliedAction(id, false) を呼ぶ', async () => {
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ eventId: 7, entryStatus: 'applied', setEntryAppliedAction })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '未申込に戻す' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(7, false)
    })
  })

  it('「未申込に戻す」(not_applying から) は confirm を出さず setEntryAppliedAction(id, false) を呼ぶ', async () => {
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({ eventId: 7, entryStatus: 'not_applying', setEntryAppliedAction })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '未申込に戻す' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(7, false)
    })
  })

  it('「申込済にする」(not_applied から, linked) は既存どおり通知 confirm を出す', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'not_applied',
          isLineLinked: true,
          setEntryAppliedAction,
        })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))

    expect(window.confirm).toHaveBeenCalledWith(
      '参加者の LINE グループに通知が送られます。よろしいですか？',
    )
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(1, true)
    })
  })
})

describe('EventLifecycleSection — entry-groups タスク4: 一括ダイアログ', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const siblings = [
    { id: 1, title: 'C級', eventDate: '2026-08-01', eligibleGrades: null, status: 'published' as const },
    { id: 2, title: 'D級', eventDate: '2026-08-08', eligibleGrades: null, status: 'published' as const },
  ]

  it('groupSiblings が1件以下のときは従来どおり（ダイアログを出さず直接 action を呼ぶ）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          eventId: 1,
          entryStatus: 'not_applied',
          setEntryAppliedAction,
          groupSiblings: [siblings[0]!],
        })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => {
      expect(setEntryAppliedAction).toHaveBeenCalledWith(1, true)
    })
  })

  it('groupSiblings が2件以上のとき「申込済にする」でダイアログが開く（scalar action は呼ばれない）', async () => {
    const setEntryAppliedAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'not_applied',
          setEntryAppliedAction,
          groupSiblings: siblings,
        })}
      />,
    )
    openAllDetails(container)

    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(setEntryAppliedAction).not.toHaveBeenCalled()
    expect(screen.getByText(/C級/)).toBeTruthy()
    expect(screen.getByText(/D級/)).toBeTruthy()
  })

  it('cancelled の日はチェックボックスが disabled で既定チェックにも含まれない', async () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'not_applied',
          groupSiblings: [
            siblings[0]!,
            { ...siblings[1]!, status: 'cancelled' as const },
          ],
        })}
      />,
    )
    openAllDetails(container)
    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes).toHaveLength(2)
    const cancelledCheckbox = checkboxes.find((cb) => !cb.checked)
    expect(cancelledCheckbox?.disabled).toBe(true)
  })

  it('ダイアログで確定すると通知 confirm 後に setEntriesAppliedAction が選択 id 配列で呼ばれる（AC-8）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const setEntriesAppliedAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'not_applied',
          isLineLinked: true,
          groupSiblings: siblings,
          setEntriesAppliedAction,
        })}
      />,
    )
    openAllDetails(container)
    fireEvent.click(screen.getByRole('button', { name: '申込済にする' }))
    fireEvent.click(screen.getByRole('button', { name: '実行' }))

    expect(window.confirm).toHaveBeenCalledWith(
      '参加者の LINE グループに通知が送られます。よろしいですか？',
    )
    await waitFor(() => {
      expect(setEntriesAppliedAction).toHaveBeenCalledWith([1, 2], true)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('支払いタイプ変更（select）は通知確認なしでダイアログ経由 setPaymentTypesAction を呼ぶ（AC-10）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const setPaymentTypesAction = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryStatus: 'applied',
          groupSiblings: siblings,
          setPaymentTypesAction,
        })}
      />,
    )
    openAllDetails(container)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'advance' } })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '実行' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(setPaymentTypesAction).toHaveBeenCalledWith([1, 2], 'advance')
    })
  })
})

describe('EventLifecycleSection — entry-form-autofill タスク8: 申込書の行（AC-3, AC-17, AC-19）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('entryFormGroupId が無ければ「申込書」行は出ない（団体戦・一般会員）', () => {
    const { container } = render(<EventLifecycleSection {...baseProps()} />)
    openAllDetails(container)
    expect(container.textContent).not.toContain('申込書')
  })

  it('未作成なら「未作成」＋作成リンクが出る（AC-3）', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryFormGroupId: 42 })} />,
    )
    openAllDetails(container)

    expect(container.textContent).toContain('申込書')
    expect(container.textContent).toContain('未作成')
    expect(
      screen.getByRole('link', { name: '申込書を作成' }).getAttribute('href'),
    ).toBe('/admin/entry-form/42')
  })

  it('作成済なら日時・作成者・ファイル名とダウンロード導線、リンクは「再作成」になる（AC-17）', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryFormGroupId: 42,
          entryFormLatestDraft: {
            id: 7,
            createdAt: new Date('2026-07-27T12:04:00.000Z'),
            createdByName: '土居 悠太',
            attachmentFilename: '【北海道大学かるた会】第３回青森大会参加申込書.xlsx',
            status: 'created',
          },
        })}
      />,
    )
    openAllDetails(container)

    expect(container.textContent).toContain('下書き作成済')
    expect(container.textContent).toContain('土居 悠太')
    expect(container.textContent).toContain('第３回青森大会参加申込書.xlsx')
    expect(screen.getByRole('link', { name: 'DL' }).getAttribute('href')).toBe(
      '/api/admin/entry-form/drafts/7',
    )
    expect(
      screen.getByRole('link', { name: '再作成' }).getAttribute('href'),
    ).toBe('/admin/entry-form/42')
  })

  it('IMAP 失敗の履歴は「下書き未作成（失敗）」として区別される', () => {
    const { container } = render(
      <EventLifecycleSection
        {...baseProps({
          entryFormGroupId: 42,
          entryFormLatestDraft: {
            id: 8,
            createdAt: new Date('2026-07-27T12:04:00.000Z'),
            createdByName: null,
            attachmentFilename: 'draft.xlsx',
            status: 'imap_failed',
          },
        })}
      />,
    )
    openAllDetails(container)

    expect(container.textContent).toContain('下書き未作成（失敗）')
    // 成果物は残っているので再ダウンロードはできる。
    expect(screen.getByRole('link', { name: 'DL' })).toBeTruthy()
  })

  it('申込状態・支払状態の既存行は変わらない（AC-19 回帰）', () => {
    const { container } = render(
      <EventLifecycleSection {...baseProps({ entryFormGroupId: 42 })} />,
    )
    openAllDetails(container)

    expect(container.textContent).toContain('申込状態')
    expect(container.textContent).toContain('支払状態')
    expect(screen.getByRole('button', { name: '申込済にする' })).toBeTruthy()
  })
})
