import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UpdateNameState, UpdateProfileState } from './actions'
import type { Grade, Gender } from '@kagetra/shared/types'

const updateMemberProfileMock = vi.fn<
  (prev: UpdateProfileState, fd: FormData) => Promise<UpdateProfileState>
>()
const updateMemberNameMock = vi.fn<
  (prev: UpdateNameState, fd: FormData) => Promise<UpdateNameState>
>()

vi.mock('./actions', () => ({
  updateMemberProfile: (prev: UpdateProfileState, fd: FormData) =>
    updateMemberProfileMock(prev, fd),
  updateMemberName: (prev: UpdateNameState, fd: FormData) =>
    updateMemberNameMock(prev, fd),
}))

const { EditMemberForm } = await import('./edit-member-form')

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E'] as const
const GENDERS: readonly Gender[] = ['male', 'female'] as const

function renderForm(nameEditable: boolean) {
  return render(
    <EditMemberForm
      userId="user-1"
      name="現在の名前"
      nameEditable={nameEditable}
      grade={null}
      gender={null}
      affiliation=""
      dan={null}
      zenNichikyo={false}
      grades={GRADES}
      genders={GENDERS}
    />,
  )
}

describe('EditMemberForm — nameEditable による名前編集の出し分け', () => {
  beforeEach(() => {
    updateMemberProfileMock.mockReset()
    updateMemberNameMock.mockReset()
  })

  it('編集不可 (紐付け済み or admin/vice_admin): readOnly + 変更不可の注記、保存ボタンなし', () => {
    renderForm(false)

    const nameInput = screen.getByDisplayValue('現在の名前') as HTMLInputElement
    expect(nameInput.readOnly).toBe(true)
    expect(
      screen.getByText(
        'ユーザー名はログインに使われるため、この画面からは変更できません。',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: '名前を保存' })).toBeNull()
  })

  it('編集可 (未紐付け member): 編集可能な独立フォーム + 修正可の注記が出る', () => {
    const { container } = renderForm(true)

    const nameInput = screen.getByLabelText('名前') as HTMLInputElement
    expect(nameInput.readOnly).toBe(false)
    expect(nameInput.value).toBe('現在の名前')
    expect(
      screen.getByText('LINE 紐付け前のため修正できます。'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '名前を保存' })).toBeTruthy()

    // 名前フォームとプロフィールフォームは別 <form>（誤爆防止）
    const forms = container.querySelectorAll('form')
    expect(forms).toHaveLength(2)
    const nameForm = forms[0]
    expect(nameForm?.contains(nameInput)).toBe(true)
    expect(nameForm?.querySelector('select')).toBeNull()
  })

  it('編集可: 名前フォーム送信で updateMemberName に userId と名前が渡る', async () => {
    updateMemberNameMock.mockResolvedValue({ success: true })
    const { container } = renderForm(true)

    fireEvent.change(screen.getByLabelText('名前'), {
      target: { value: '修正後の名前' },
    })
    const nameForm = container.querySelectorAll('form')[0]
    if (!nameForm) throw new Error('name form not found')
    fireEvent.submit(nameForm)

    await waitFor(() => expect(updateMemberNameMock).toHaveBeenCalledTimes(1))
    const fd = updateMemberNameMock.mock.calls[0]?.[1]
    expect(fd?.get('userId')).toBe('user-1')
    expect(fd?.get('name')).toBe('修正後の名前')
    expect(updateMemberProfileMock).not.toHaveBeenCalled()

    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('名前を変更しました。')
  })

  it('編集可: エラー時は role=alert で表示され入力値は保持される', async () => {
    updateMemberNameMock.mockResolvedValue({
      error: 'LINE 紐付け済みのため変更できません',
    })
    const { container } = renderForm(true)

    fireEvent.change(screen.getByLabelText('名前'), {
      target: { value: '保持される名前' },
    })
    const nameForm = container.querySelectorAll('form')[0]
    if (!nameForm) throw new Error('name form not found')
    fireEvent.submit(nameForm)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('LINE 紐付け済みのため変更できません')
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe(
      '保持される名前',
    )
  })
})
