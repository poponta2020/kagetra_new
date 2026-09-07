import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BulkUpdateCircleState } from './actions'

const bulkUpdateCircleMembersMock = vi.fn<
  (prev: BulkUpdateCircleState, fd: FormData) => Promise<BulkUpdateCircleState>
>()

vi.mock('./actions', () => ({
  bulkUpdateCircleMembers: (prev: BulkUpdateCircleState, fd: FormData) =>
    bulkUpdateCircleMembersMock(prev, fd),
}))

const { CircleBulkEditTable } = await import('./circle-bulk-edit-table')

const MEMBERS = [
  {
    id: 'u1',
    name: '影虎 一郎',
    isCircleMember: false,
    facultyKind: null,
    faculty: null,
    schoolYear: null,
  },
  {
    id: 'u2',
    name: '影虎 二郎',
    isCircleMember: true,
    facultyKind: 'graduate' as const,
    faculty: '情報科学院',
    schoolYear: '修士1年',
  },
]

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

describe('CircleBulkEditTable', () => {
  beforeEach(() => {
    bulkUpdateCircleMembersMock.mockReset()
    bulkUpdateCircleMembersMock.mockResolvedValue({})
  })

  it('サークル所属 OFF の行は所属・学部等名・学年の入力欄が出ない', () => {
    render(<CircleBulkEditTable members={MEMBERS} />)
    expect(screen.queryByLabelText('影虎 一郎 の所属')).toBeNull()
  })

  it('サークル所属 ON の行は既存値付きで所属・学部等名・学年が出る', () => {
    render(<CircleBulkEditTable members={MEMBERS} />)
    expect((screen.getByLabelText('影虎 二郎 の所属') as HTMLSelectElement).value).toBe(
      'graduate',
    )
    expect((screen.getByLabelText('影虎 二郎 の学年') as HTMLSelectElement).value).toBe(
      '修士1年',
    )
  })

  it('チェックを入れると所属・学部等名・学年が開く', () => {
    render(<CircleBulkEditTable members={MEMBERS} />)
    fireEvent.click(screen.getByLabelText('影虎 一郎 のサークル所属'))
    expect(screen.getByLabelText('影虎 一郎 の所属')).toBeTruthy()
  })

  it('保存で複数人ぶんの値が1回のFormDataに渡る', async () => {
    const { container } = render(<CircleBulkEditTable members={MEMBERS} />)
    fireEvent.click(screen.getByLabelText('影虎 一郎 のサークル所属'))
    fireEvent.change(screen.getByLabelText('影虎 一郎 の所属'), {
      target: { value: 'undergraduate' },
    })
    submitForm(container)

    await waitFor(() => expect(bulkUpdateCircleMembersMock).toHaveBeenCalledTimes(1))
    const fd = bulkUpdateCircleMembersMock.mock.calls[0]?.[1]
    expect(fd?.getAll('userIds')).toEqual(['u1', 'u2'])
    expect(fd?.get('isCircleMember_u1')).toBe('on')
    expect(fd?.get('facultyKind_u1')).toBe('undergraduate')
    expect(fd?.get('isCircleMember_u2')).toBe('on')
    expect(fd?.get('facultyKind_u2')).toBe('graduate')
    expect(fd?.get('faculty_u2')).toBe('情報科学院')
    expect(fd?.get('schoolYear_u2')).toBe('修士1年')
  })

  it('エラーは role=alert で表示される', async () => {
    bulkUpdateCircleMembersMock.mockResolvedValue({ error: '学部等名を入力してください' })
    const { container } = render(<CircleBulkEditTable members={MEMBERS} />)
    submitForm(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('学部等名を入力してください')
  })

  it('成功時は件数付きの role=status が表示される', async () => {
    bulkUpdateCircleMembersMock.mockResolvedValue({ success: true, updatedCount: 2 })
    const { container } = render(<CircleBulkEditTable members={MEMBERS} />)
    submitForm(container)

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('2件')
  })
})
