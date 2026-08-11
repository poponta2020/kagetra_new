import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { UpdateRoleState } from './actions'

const updateMemberRoleMock = vi.fn<
  (prev: UpdateRoleState, fd: FormData) => Promise<UpdateRoleState>
>()

vi.mock('./actions', () => ({
  updateMemberRole: (prev: UpdateRoleState, fd: FormData) =>
    updateMemberRoleMock(prev, fd),
}))

const { MemberRoleSection } = await import('./member-role-section')

type Props = Parameters<typeof MemberRoleSection>[0]

function renderSection(overrides: Partial<Props> = {}) {
  const props: Props = {
    userId: 'u1',
    memberName: '影虎 太郎',
    currentRole: 'member',
    isSelf: false,
    lineLinked: true,
    deactivated: false,
    ...overrides,
  }
  return render(<MemberRoleSection {...props} />)
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

function optionByLabel(label: string): HTMLOptionElement {
  const option = screen
    .getAllByRole('option')
    .find((el) => el.textContent === label)
  if (!option) throw new Error(`option not found: ${label}`)
  return option as HTMLOptionElement
}

describe('MemberRoleSection', () => {
  beforeEach(() => {
    updateMemberRoleMock.mockReset()
    updateMemberRoleMock.mockResolvedValue({ success: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('現在のロールが日本語で表示される（AC-18）', () => {
    renderSection({ currentRole: 'vice_admin' })
    expect(screen.getByText('現在: 副管理者')).toBeTruthy()
  })

  it('現在のロールがゲストのときも日本語で表示される（AC-25）', () => {
    renderSection({ currentRole: 'guest' })
    expect(screen.getByText('現在: ゲスト')).toBeTruthy()
  })

  it('選択肢が日本語ラベルで並ぶ（AC-18・AC-25 の4択化）', () => {
    renderSection()
    const labels = screen.getAllByRole('option').map((el) => el.textContent)
    expect(labels).toEqual(['管理者', '副管理者', '一般会員', 'ゲスト'])
  })

  it('保存でダイアログが出て、キャンセルすると action が呼ばれない（AC-19）', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = renderSection()

    submitForm(container)

    expect(confirmSpy).toHaveBeenCalled()
    expect(updateMemberRoleMock).not.toHaveBeenCalled()
  })

  it('ダイアログで OK すると action が呼ばれる（AC-19）', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = renderSection()

    submitForm(container)

    expect(confirmSpy).toHaveBeenCalled()
    expect(updateMemberRoleMock).toHaveBeenCalled()
  })

  it('確認文には選択中のロール名が入る（AC-19）', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = renderSection({ memberName: '影虎 太郎' })

    fireEvent.change(screen.getByLabelText('ロール'), {
      target: { value: 'vice_admin' },
    })
    submitForm(container)

    expect(confirmSpy).toHaveBeenCalledWith(
      '「影虎 太郎」のロールを副管理者に変更します。よろしいですか？',
    )
  })

  it('自分自身の行では理由が表示され、フォームが出ない（AC-21）', () => {
    const { container } = renderSection({ isSelf: true, currentRole: 'admin' })

    expect(screen.getByText(/ご自身のロールは変更できません/)).toBeTruthy()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByLabelText('ロール')).toBeNull()
  })

  it('LINE 未紐付けの行は昇格の選択肢が無効になり理由が出る（AC-21・AC-26 はゲストに及ばない）', () => {
    renderSection({ lineLinked: false })

    expect(screen.getByText(/LINE 紐付け前の会員は管理者・副管理者にできません/)).toBeTruthy()
    expect(optionByLabel('管理者').disabled).toBe(true)
    expect(optionByLabel('副管理者').disabled).toBe(true)
    expect(optionByLabel('一般会員').disabled).toBe(false)
    expect(optionByLabel('ゲスト').disabled).toBe(false)
  })

  it('退会済みの行は昇格の選択肢が無効になり理由が出る（AC-21・AC-26 はゲストに及ばない）', () => {
    renderSection({ deactivated: true })

    expect(screen.getByText(/退会済みの会員は管理者・副管理者にできません/)).toBeTruthy()
    expect(optionByLabel('管理者').disabled).toBe(true)
    expect(optionByLabel('副管理者').disabled).toBe(true)
    expect(optionByLabel('一般会員').disabled).toBe(false)
    expect(optionByLabel('ゲスト').disabled).toBe(false)
  })

  it('昇格が塞がれていても現在のロールは選択できる（退会済みの副管理者を降格する導線）', () => {
    renderSection({ deactivated: true, currentRole: 'vice_admin' })

    expect(optionByLabel('副管理者').disabled).toBe(false)
    expect(optionByLabel('管理者').disabled).toBe(true)
  })

  it('エラーは role="alert" で表示される', async () => {
    updateMemberRoleMock.mockResolvedValue({ error: 'ご自身のロールは変更できません' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = renderSection()

    submitForm(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('ご自身のロールは変更できません')
  })

  it('成功は role="status" で表示される', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = renderSection()

    submitForm(container)

    const success = await screen.findByText('ロールを変更しました。')
    expect(success.getAttribute('role')).toBe('status')
  })
})
