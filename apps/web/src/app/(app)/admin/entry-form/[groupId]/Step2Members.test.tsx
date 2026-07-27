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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
    expect(container.textContent).toContain('参加級が未登録です')
  })

  it('appearanceCompleteness が incomplete のとき出場回数の警告が出る', () => {
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="incomplete"
        appearanceIncompleteGrades={null}
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
    expect(screen.getByText(/出場回数の算出に名簿未取込の大会があります/)).toBeTruthy()
  })

  it('警告が無ければバナーは出ない', () => {
    render(
      <Step2Members
        members={[wm()]}
        appearanceCompleteness="complete"
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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
        appearanceIncompleteGrades={[]}
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

describe('Step2Members — 参加級 未登録の扱い（AC-5b）', () => {
  const baseProps = (over: Record<string, unknown> = {}) => ({
    appearanceCompleteness: 'complete' as const,
    appearanceIncompleteGrades: [],
    onExclude: vi.fn(),
    onInclude: vi.fn(),
    onEditRequest: vi.fn(),
    onAddMember: vi.fn(),
    addableMembers: null,
    onRequestAddable: vi.fn(),
    addableLoading: false,
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...over,
  })

  it('級セルが「未設定」になり、行にも警告が出る', () => {
    const { container } = render(
      <Step2Members {...baseProps({ members: [wm({ grade: null })] })} />,
    )
    expect(container.textContent).toContain('未設定')
    expect(container.textContent).toContain('参加級が未登録')
  })

  it('警告先出し面に「空欄のままでも作成できます」が出る', () => {
    const { container } = render(
      <Step2Members {...baseProps({ members: [wm({ grade: null })] })} />,
    )
    expect(container.textContent).toContain('空欄のままでも作成できます')
  })

  it('級未設定は A〜E級の人数に混入せず「級未設定 N」として別に出る', () => {
    const { container } = render(
      <Step2Members
        {...baseProps({
          members: [
            wm({ userId: 'a1', grade: 'A' }),
            wm({ userId: 'a2', grade: 'A' }),
            wm({ userId: 'x1', grade: null }),
          ],
        })}
      />,
    )
    // A級は2名のまま（級未設定を足して3にしない）。
    expect(container.textContent).toContain('A級 2')
    expect(container.textContent).toContain('級未設定 1')
    expect(container.textContent).toContain('計 3名')
  })

  it('級が未設定でも「次へ」は無効化されない', () => {
    render(<Step2Members {...baseProps({ members: [wm({ grade: null })] })} />)
    const next = screen.getByRole('button', { name: /次へ/ })
    expect(next.hasAttribute('disabled')).toBe(false)
  })

  it('級が全員設定済みなら「級未設定」は出ない', () => {
    const { container } = render(
      <Step2Members {...baseProps({ members: [wm({ grade: 'A' })] })} />,
    )
    expect(container.textContent).not.toContain('級未設定')
  })
})

describe('Step2Members — 出場回数 incomplete の行単位警告（AC-9b）', () => {
  const baseProps = (over: Record<string, unknown> = {}) => ({
    onExclude: vi.fn(),
    onInclude: vi.fn(),
    onEditRequest: vi.fn(),
    onAddMember: vi.fn(),
    addableMembers: null,
    onRequestAddable: vi.fn(),
    addableLoading: false,
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...over,
  })

  it('complete のときは警告が出ない', () => {
    const { container } = render(
      <Step2Members
        {...baseProps({
          members: [wm({ grade: 'C' })],
          appearanceCompleteness: 'complete',
          appearanceIncompleteGrades: [],
        })}
      />,
    )
    expect(container.textContent).not.toContain('名簿未取込')
  })

  it('欠落した級の会員だけに警告が出る', () => {
    const { container } = render(
      <Step2Members
        {...baseProps({
          members: [
            wm({ userId: 'c1', displayName: '該当 会員', grade: 'C' }),
            wm({ userId: 'a1', displayName: '対象外 会員', grade: 'A' }),
          ],
          appearanceCompleteness: 'incomplete',
          appearanceIncompleteGrades: ['C'],
        })}
      />,
    )
    expect(container.textContent).toContain('名簿未取込')
    // 警告先出し面で名指しされるのは該当級の会員だけ。
    expect(screen.getByRole('button', { name: '該当 会員' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '対象外 会員' })).toBeNull()
  })

  it('欠落の級を特定できない（null）ときは全員が対象になる', () => {
    render(
      <Step2Members
        {...baseProps({
          members: [
            wm({ userId: 'c1', displayName: '会員 A', grade: 'C' }),
            wm({ userId: 'a1', displayName: '会員 B', grade: 'A' }),
          ],
          appearanceCompleteness: 'incomplete',
          appearanceIncompleteGrades: null,
        })}
      />,
    )
    expect(screen.getByRole('button', { name: '会員 A' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '会員 B' })).toBeTruthy()
  })
})
