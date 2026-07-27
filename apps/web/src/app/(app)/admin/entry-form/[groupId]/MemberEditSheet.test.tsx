import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemberEditSheet } from './MemberEditSheet'
import type { WizardMember } from './wizard-types'

function wm(overrides: Partial<WizardMember> = {}): WizardMember {
  return {
    userId: 'u1',
    displayName: '松田 結菜',
    needsNameInput: true,
    excluded: false,
    grade: 'B',
    dan: 3,
    familyName: '松田',
    givenName: '結菜',
    familyKana: null,
    givenKana: null,
    appearanceCount: 0,
    note: null,
    ...overrides,
  }
}

describe('MemberEditSheet — かな未登録の警告と保存（b-step2-edit.html）', () => {
  it('かな未登録の警告文が出る', () => {
    render(<MemberEditSheet member={wm()} onClose={vi.fn()} onSave={vi.fn()} onExclude={vi.fn()} />)
    expect(
      screen.getByText('ふりがなが未登録です。入力すると会員情報にも保存され、次回から自動で記入されます。'),
    ).toBeTruthy()
  })

  it('姓名・かな以外（参加級・段位・出場回数・備考）の変更はこの申込書だけ、という注記が出る', () => {
    render(<MemberEditSheet member={wm()} onClose={vi.fn()} onSave={vi.fn()} onExclude={vi.fn()} />)
    expect(
      screen.getByText('参加級・段位・出場回数・備考の変更はこの申込書だけに反映されます（会員情報は変わりません）'),
    ).toBeTruthy()
  })

  it('保存すると入力値で onSave が呼ばれる', () => {
    const onSave = vi.fn()
    render(<MemberEditSheet member={wm()} onClose={vi.fn()} onSave={onSave} onExclude={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/ふりがな（姓）/), { target: { value: 'まつだ' } })
    fireEvent.change(screen.getByLabelText(/ふりがな（名）/), { target: { value: 'ゆいな' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith({
      familyName: '松田',
      givenName: '結菜',
      familyKana: 'まつだ',
      givenKana: 'ゆいな',
      grade: 'B',
      dan: 3,
      appearanceCount: 0,
      note: null,
    })
  })

  it('「この会員を外す」で onExclude と onClose が呼ばれる', () => {
    const onExclude = vi.fn()
    const onClose = vi.fn()
    render(<MemberEditSheet member={wm()} onClose={onClose} onSave={vi.fn()} onExclude={onExclude} />)
    fireEvent.click(screen.getByText('この会員を外す'))
    expect(onExclude).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('かな登録済みの会員では警告文が出ない', () => {
    render(
      <MemberEditSheet
        member={wm({ needsNameInput: false, familyKana: 'まつだ', givenKana: 'ゆいな' })}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onExclude={vi.fn()}
      />,
    )
    expect(
      screen.queryByText('ふりがなが未登録です。入力すると会員情報にも保存され、次回から自動で記入されます。'),
    ).toBeNull()
  })
})
