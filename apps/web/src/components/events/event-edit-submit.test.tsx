import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FormEvent } from 'react'
import { EventEditSubmit, type PropagationSibling } from './event-edit-submit'

/**
 * entry-groups タスク2 / AC-19: 締切・支払い系フィールドの変更保存時に伝播確認ダイアログが
 * 出る（選択した日にのみ同値を保存・日固有フィールドは対象外）。
 *
 * `EventEditSubmit` は「ダイアログを出すかどうか」の UX 判断だけを担う——実際の再検証
 * （変更フィールドの差分・送信された id が同一グループか）は Server Action 側
 * （lib/entry-groups.ts の `diffPropagatableFields` / `propagateFieldsToGroup`）が行う。
 */

const INITIAL_VALUES = {
  entryDeadline: '2026-07-01',
  internalDeadline: '',
  paymentDeadline: '',
  paymentDeadlineKind: 'unspecified',
  lotteryDate: '',
  paymentMethod: '',
  paymentInfo: '',
  entryMethod: '',
}

const SIBLINGS: PropagationSibling[] = [{ id: 2, title: '多摩B', eventDate: '2026-07-12' }]

function Harness({
  onSubmit,
  siblings = SIBLINGS,
  groupAction = 'keep',
  // mail-ai-extract-refinements §3.2.7: 実フォーム（event-form.tsx）は状態を
  // `<select>` で描画する。要素が存在しないフォーム構成でも落ちないことを
  // 確認したいテストのために描画を切れるようにする。
  withPaymentDeadlineKindSelect = true,
}: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  siblings?: PropagationSibling[]
  groupAction?: string
  withPaymentDeadlineKindSelect?: boolean
}) {
  return (
    <form onSubmit={onSubmit}>
      <input name="entryDeadline" defaultValue={INITIAL_VALUES.entryDeadline} />
      <input name="internalDeadline" defaultValue={INITIAL_VALUES.internalDeadline} />
      <input name="paymentDeadline" defaultValue={INITIAL_VALUES.paymentDeadline} />
      {withPaymentDeadlineKindSelect && (
        <select
          name="paymentDeadlineKind"
          defaultValue={INITIAL_VALUES.paymentDeadlineKind}
        >
          <option value="fixed">日付あり</option>
          <option value="later_notice">後日連絡</option>
          <option value="unspecified">締切未設定</option>
        </select>
      )}
      <input name="lotteryDate" defaultValue={INITIAL_VALUES.lotteryDate} />
      <input name="paymentMethod" defaultValue={INITIAL_VALUES.paymentMethod} />
      <textarea name="paymentInfo" defaultValue={INITIAL_VALUES.paymentInfo} />
      <input name="entryMethod" defaultValue={INITIAL_VALUES.entryMethod} />
      <input type="hidden" name="entry_group_action" value={groupAction} readOnly />
      <EventEditSubmit label="更新" initialValues={INITIAL_VALUES} siblings={siblings} />
    </form>
  )
}

describe('EventEditSubmit — 伝播確認ダイアログ', () => {
  it('締切系フィールドを変更していなければダイアログを出さずそのまま送信する', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    expect(screen.queryByText('同じグループの他の日にも反映しますか？')).toBeNull()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('伝播対象フィールド（entryDeadline）を変更すると保存前に確認ダイアログが出る', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    expect(screen.getByText('同じグループの他の日にも反映しますか？')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ダイアログの対象日はチェック済み（既定全チェック）で描画される', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    const checkbox = screen.getByLabelText(/多摩B/) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('保存を押すと、チェックしたままの日の id が propagate_event_ids として送信される', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      expect(fd.getAll('propagate_event_ids')).toEqual(['2'])
    })
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('チェックを外した日は propagate_event_ids に含まれない（日別差を許容）', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      expect(fd.getAll('propagate_event_ids')).toEqual([])
    })
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByLabelText(/多摩B/)) // uncheck
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  // r4 review blocker: hidden input を追加するだけだと、submit が中断された後に
  // チェックを外して再送信したとき、外した日の id が前回分として残り、明示的に
  // 除外した日にも伝播してしまう。生成した input は毎回作り直す。
  it('r4: 送信が中断された後に選択を変えて再送信すると、古い伝播対象は残らない', () => {
    const seen: string[][] = []
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      seen.push(new FormData(e.currentTarget).getAll('propagate_event_ids') as string[])
    })
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    // 1回目: 既定の全チェックのまま保存（= 中断された送信を模す。フォームは残る）
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(seen[0]).toEqual(['2'])

    // 2回目: 同じフォームでチェックを外して再送信
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByLabelText(/多摩B/)) // uncheck
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    // 前回の '2' が残っていない（残っていると除外した日を上書きしてしまう）
    expect(seen[1]).toEqual([])
  })

  it('キャンセルを押すとダイアログが閉じて送信されない', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText('同じグループの他の日にも反映しますか？')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("グループ付け替え（entry_group_action != 'keep'）を選んでいるときはダイアログを出さない", () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} groupAction="standalone" />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    expect(screen.queryByText('同じグループの他の日にも反映しますか？')).toBeNull()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('同グループに他の日が無ければ、変更があってもダイアログを出さない', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
    render(<Harness onSubmit={onSubmit} siblings={[]} />)

    fireEvent.change(screen.getByDisplayValue('2026-07-01'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    expect(screen.queryByText('同じグループの他の日にも反映しますか？')).toBeNull()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  // mail-ai-extract-refinements タスク12 (§3.2.7): 状態（paymentDeadlineKind）だけを
  // 変更したときも伝播確認ダイアログを出す。日付と状態は CHECK 制約で対になっている
  // ため、片方だけ伝播すると伝播先で制約違反になる。
  describe('paymentDeadlineKind（振込締切の状態）', () => {
    it('paymentDeadlineKind を変更するとダイアログが出る', () => {
      const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
      render(<Harness onSubmit={onSubmit} />)

      fireEvent.change(screen.getByDisplayValue('締切未設定'), {
        target: { value: 'later_notice' },
      })
      fireEvent.click(screen.getByRole('button', { name: '更新' }))

      expect(screen.getByText('同じグループの他の日にも反映しますか？')).toBeTruthy()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('フォームに paymentDeadlineKind の要素が無くても落ちない（変更なし扱い）', () => {
      const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault())
      render(<Harness onSubmit={onSubmit} withPaymentDeadlineKindSelect={false} />)

      fireEvent.click(screen.getByRole('button', { name: '更新' }))

      expect(screen.queryByText('同じグループの他の日にも反映しますか？')).toBeNull()
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
  })
})
