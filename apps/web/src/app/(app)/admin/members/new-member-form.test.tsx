import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CreateMemberState } from './actions'

const createMemberMock = vi.fn<
  (prev: CreateMemberState, fd: FormData) => Promise<CreateMemberState>
>()

vi.mock('./actions', () => ({
  createMember: (prev: CreateMemberState, fd: FormData) =>
    createMemberMock(prev, fd),
}))

const { NewMemberForm } = await import('./new-member-form')

function openForm() {
  fireEvent.click(screen.getByRole('button', { name: '新規会員追加' }))
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

describe('NewMemberForm', () => {
  beforeEach(() => {
    createMemberMock.mockReset()
  })

  it('初期状態は「新規会員追加」ボタンのみでフォームは閉じている', () => {
    render(<NewMemberForm />)
    expect(screen.getByRole('button', { name: '新規会員追加' })).toBeTruthy()
    expect(screen.queryByLabelText(/名前/)).toBeNull()
  })

  it('ボタンで開閉できる', () => {
    render(<NewMemberForm />)
    openForm()
    expect(screen.getByLabelText(/名前/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByLabelText(/名前/)).toBeNull()
    expect(screen.getByRole('button', { name: '新規会員追加' })).toBeTruthy()
  })

  it('名前 input・級 select（未設定+A〜E級）・登録ボタンが揃っている', () => {
    render(<NewMemberForm />)
    openForm()

    expect(screen.getByLabelText(/名前/)).toBeTruthy()
    const gradeSelect = screen.getByLabelText('級') as HTMLSelectElement
    const labels = Array.from(gradeSelect.options).map((o) => o.textContent)
    expect(labels).toEqual(['未設定', 'A級', 'B級', 'C級', 'D級', 'E級'])
    expect(screen.getByRole('button', { name: '登録' })).toBeTruthy()
  })

  it('送信すると name と grade が FormData で action に渡る', async () => {
    createMemberMock.mockResolvedValue({ success: true })
    const { container } = render(<NewMemberForm />)
    openForm()

    fireEvent.change(screen.getByLabelText(/名前/), {
      target: { value: '新井太郎' },
    })
    fireEvent.change(screen.getByLabelText('級'), { target: { value: 'C' } })
    submitForm(container)

    await waitFor(() => expect(createMemberMock).toHaveBeenCalledTimes(1))
    const fd = createMemberMock.mock.calls[0]?.[1]
    expect(fd?.get('name')).toBe('新井太郎')
    expect(fd?.get('grade')).toBe('C')
  })

  it('action がエラーを返すと role=alert で表示され、入力値は保持される', async () => {
    createMemberMock.mockResolvedValue({
      error: '同名の会員が既に存在します（退会済み会員を含む）',
    })
    const { container } = render(<NewMemberForm />)
    openForm()

    fireEvent.change(screen.getByLabelText(/名前/), {
      target: { value: '重複会員' },
    })
    submitForm(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('同名の会員が既に存在します（退会済み会員を含む）')
    // 入力値はリセットされない（修正して再送信できる）
    expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe(
      '重複会員',
    )
  })

  it('成功すると成功メッセージが出てフォームがリセットされる', async () => {
    createMemberMock.mockResolvedValue({ success: true })
    const { container } = render(<NewMemberForm />)
    openForm()

    fireEvent.change(screen.getByLabelText(/名前/), {
      target: { value: '札幌次郎' },
    })
    fireEvent.change(screen.getByLabelText('級'), { target: { value: 'B' } })
    submitForm(container)

    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('登録しました。')
    expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('級') as HTMLSelectElement).value).toBe('')
  })
})
