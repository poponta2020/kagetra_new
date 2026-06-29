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
      familyName=""
      givenName=""
      familyKana=""
      givenKana=""
      birthDate=""
      phone=""
      postalCode=""
      address1=""
      address2=""
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

describe('EditMemberForm — 構造化氏名＋全日協PII 列の表示/編集', () => {
  beforeEach(() => {
    updateMemberProfileMock.mockReset()
    updateMemberNameMock.mockReset()
  })

  it('新9列の入力欄が表示される', () => {
    renderForm(false)
    expect(screen.getByLabelText('姓（漢字）')).toBeTruthy()
    expect(screen.getByLabelText('名（漢字）')).toBeTruthy()
    expect(screen.getByLabelText('せい（ふりがな）')).toBeTruthy()
    expect(screen.getByLabelText('めい（ふりがな）')).toBeTruthy()
    expect(screen.getByLabelText('生年月日')).toBeTruthy()
    expect(screen.getByLabelText('電話番号')).toBeTruthy()
    expect(screen.getByLabelText('郵便番号')).toBeTruthy()
    expect(screen.getByLabelText('住所1（丁目・番地まで）')).toBeTruthy()
    expect(screen.getByLabelText('住所2（建物名・部屋番号）')).toBeTruthy()
  })

  it('プロフィール保存で新9列が FormData に渡る', async () => {
    updateMemberProfileMock.mockResolvedValue({ success: true })
    const { container } = renderForm(false)

    fireEvent.change(screen.getByLabelText('姓（漢字）'), { target: { value: '山田' } })
    fireEvent.change(screen.getByLabelText('名（漢字）'), { target: { value: '太郎' } })
    fireEvent.change(screen.getByLabelText('せい（ふりがな）'), { target: { value: 'やまだ' } })
    fireEvent.change(screen.getByLabelText('めい（ふりがな）'), { target: { value: 'たろう' } })
    fireEvent.change(screen.getByLabelText('生年月日'), { target: { value: '1990-04-01' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-1234-5678' } })
    fireEvent.change(screen.getByLabelText('郵便番号'), { target: { value: '001-0010' } })
    fireEvent.change(screen.getByLabelText('住所1（丁目・番地まで）'), { target: { value: '札幌市北区北十条西1-1' } })
    fireEvent.change(screen.getByLabelText('住所2（建物名・部屋番号）'), { target: { value: '101号室' } })

    const profileForm = container.querySelector('form')
    if (!profileForm) throw new Error('profile form not found')
    fireEvent.submit(profileForm)

    await waitFor(() => expect(updateMemberProfileMock).toHaveBeenCalledTimes(1))
    const fd = updateMemberProfileMock.mock.calls[0]?.[1]
    expect(fd?.get('familyName')).toBe('山田')
    expect(fd?.get('givenName')).toBe('太郎')
    expect(fd?.get('familyKana')).toBe('やまだ')
    expect(fd?.get('givenKana')).toBe('たろう')
    expect(fd?.get('birthDate')).toBe('1990-04-01')
    expect(fd?.get('phone')).toBe('090-1234-5678')
    expect(fd?.get('postalCode')).toBe('001-0010')
    expect(fd?.get('address1')).toBe('札幌市北区北十条西1-1')
    expect(fd?.get('address2')).toBe('101号室')
  })
})
