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
}: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  siblings?: PropagationSibling[]
  groupAction?: string
}) {
  return (
    <form onSubmit={onSubmit}>
      <input name="entryDeadline" defaultValue={INITIAL_VALUES.entryDeadline} />
      <input name="internalDeadline" defaultValue={INITIAL_VALUES.internalDeadline} />
      <input name="paymentDeadline" defaultValue={INITIAL_VALUES.paymentDeadline} />
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
})
