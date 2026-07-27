import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Step2Members } from './Step2Members'
import type { WizardMember } from './wizard-types'

function wm(overrides: Partial<WizardMember> = {}): WizardMember {
  return {
    userId: 'u1',
    displayName: '青木 悠人',
    needsNameInput: false,
    excluded: false,
    grade: 'A',
    dan: 4,
    familyName: '青木',
    givenName: '悠人',
    familyKana: 'あおき',
    givenKana: 'ゆうと',
    appearanceCount: 2,
    note: null,
    ...overrides,
  }
}

describe('Step2Members — 対象会員の初期表示・除外（AC-5）', () => {
  it('対象会員が初期表示される', () => {
    render(
      <Step2Members
        members={[wm(), wm({ userId: 'u2', displayName: '石田 美咲' })]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.getByText('青木 悠人')).toBeTruthy()
    expect(screen.getByText('石田 美咲')).toBeTruthy()
  })

  it('会員行をタップすると onEditRequest が呼ばれる（編集シートを開く導線）', () => {
    const onEditRequest = vi.fn()
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={onEditRequest}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('青木 悠人'))
    expect(onEditRequest).toHaveBeenCalledWith('u1')
  })

  it('除外済み会員は一覧から消え、「＋ 会員を追加」から再追加できる', () => {
    const onInclude = vi.fn()
    render(
      <Step2Members
        members={[wm({ excluded: true })]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={onInclude}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.queryByText('青木 悠人')).toBeNull()
    fireEvent.click(screen.getByText('＋ 会員を追加'))
    // 除外した行は「戻す」、会員一覧からの新規は「追加」で区別する。
    fireEvent.click(screen.getByText('戻す'))
    expect(onInclude).toHaveBeenCalledWith('u1')
  })
})

describe('Step2Members — 警告の先出し（AC-8, AC-9）', () => {
  it('姓名かな未登録は警告バナーと該当行の印が出る', () => {
    // 警告文はボタン（会員名）と地の文が同じ <span> を共有するため、DOM 階層をまたいで
    // 複数要素が部分一致してしまう getByText(exact:false) は避け、container 全体の
    // テキストで検証する（祖先要素の曖昧一致による「複数ヒット」エラーを避けるため）。
    const { container } = render(
      <Step2Members
        members={[wm({ needsNameInput: true, familyKana: null, givenKana: null })]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(container.textContent).toContain(
      'ふりがなが未登録です。タップして入力すると会員情報にも保存されます',
    )
    expect(container.textContent).toContain('ふりがな未登録')
  })

  it('級 NULL の会員は警告バナーに出る', () => {
    const { container } = render(
      <Step2Members
        members={[wm({ grade: null })]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('参加級が未設定です')
  })

  it('appearanceCompleteness が incomplete のとき出場回数の警告が出る', () => {
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="incomplete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.getByText('出場回数の算出に名簿未取込の大会があります。値を確認してください')).toBeTruthy()
  })

  it('警告が無ければバナーは出ない', () => {
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.queryByText('参加級が未設定です', { exact: false })).toBeNull()
  })
})

describe('Step2Members — 会員一覧からの行追加（AC-5・対象0名の逃げ道）', () => {
  it('「＋ 会員を追加」を開くと候補の取得が要求される', () => {
    const onRequestAddable = vi.fn()
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={null}
        onRequestAddable={onRequestAddable}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '＋ 会員を追加' }))
    expect(onRequestAddable).toHaveBeenCalledTimes(1)
  })

  it('対象会員が0名でも候補から追加できる（空の申込書を作れないケースの逃げ道）', () => {
    const onAddMember = vi.fn()
    render(
      <Step2Members
        members={[]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={vi.fn()}
        onEditRequest={vi.fn()}
        onAddMember={onAddMember}
        addableMembers={[
          {
            userId: 'u9',
            displayName: '追加 候補',
            needsNameInput: false,
            grade: 'C',
            dan: 2,
            familyName: '追加',
            givenName: '候補',
            familyKana: 'ついか',
            givenKana: 'こうほ',
            appearanceCount: 1,
            note: null,
          },
        ]}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '＋ 会員を追加' }))
    expect(screen.getByText('追加 候補')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onAddMember).toHaveBeenCalledWith('u9')
  })

  it('除外した行は「戻す」で再追加できる', () => {
    const onInclude = vi.fn()
    render(
      <Step2Members
        members={[wm({ userId: 'u1', displayName: '除外 太郎', excluded: true })]}
        appearanceCompleteness="complete"
        onExclude={vi.fn()}
        onInclude={onInclude}
        onEditRequest={vi.fn()}
        onAddMember={vi.fn()}
        addableMembers={[]}
        onRequestAddable={vi.fn()}
        addableLoading={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '＋ 会員を追加' }))
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    expect(onInclude).toHaveBeenCalledWith('u1')
  })
})
