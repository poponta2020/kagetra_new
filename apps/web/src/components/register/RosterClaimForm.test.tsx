import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RosterClaimForm, type RosterClaimFormState } from './RosterClaimForm'
import type { RosterCandidate } from '@/lib/roster-claim-input'

const CANDIDATES: RosterCandidate[] = [
  { id: 'u1', name: '山田 太郎', needsPhone: true, needsBirthDate: false },
  { id: 'u2', name: '佐藤 花子', needsPhone: false, needsBirthDate: false },
  { id: 'u3', name: '鈴木 一郎', needsPhone: false, needsBirthDate: true },
]

function lastFormData(
  mock: ReturnType<typeof vi.fn<(prev: RosterClaimFormState, fd: FormData) => Promise<RosterClaimFormState>>>,
): FormData {
  const call = mock.mock.calls.at(-1)
  if (!call) throw new Error('action was not called')
  return call[1]
}

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

function toggleCircle() {
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: '北海道大学のサークル「北大かるた会」に所属している',
    }),
  )
}

describe('RosterClaimForm', () => {
  it('全候補の氏名がラジオとして出て、submitLabel がボタンに出る', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    expect(screen.getByRole('radio', { name: '山田 太郎' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '佐藤 花子' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '鈴木 一郎' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '続ける' })).toBeTruthy()
  })

  it('検索欄に「山田」と入れると、他の候補のラジオが消える', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.change(screen.getByLabelText('会員を検索'), { target: { value: '山田' } })
    expect(screen.getByRole('radio', { name: '山田 太郎' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '佐藤 花子' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '鈴木 一郎' })).toBeNull()
  })

  it('選択中の候補は検索に一致しなくても一覧に残り checked のまま', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.click(screen.getByRole('radio', { name: '佐藤 花子' }))
    fireEvent.change(screen.getByLabelText('会員を検索'), { target: { value: '山田' } })
    const satoRadio = screen.getByRole('radio', { name: '佐藤 花子' }) as HTMLInputElement
    expect(satoRadio).toBeTruthy()
    expect(satoRadio.checked).toBe(true)
  })

  it('初期状態（サークル所属 OFF）: 学部等名・学年・所属の欄が出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    expect(screen.queryByRole('radiogroup', { name: '所属' })).toBeNull()
    expect(screen.queryByLabelText('学部等名')).toBeNull()
    expect(screen.queryByLabelText('学年')).toBeNull()
  })

  it('サークル所属 ON: 所属セグメント・学部等名・学年が出る', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    toggleCircle()
    expect(screen.getByRole('radiogroup', { name: '所属' })).toBeTruthy()
    expect(screen.getByLabelText('学部等名')).toBeTruthy()
    expect(screen.getByLabelText('学年')).toBeTruthy()
  })

  it('needsPhone の候補を選び ON にすると電話番号欄が出て生年月日欄は出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.click(screen.getByRole('radio', { name: '山田 太郎' }))
    toggleCircle()
    expect(screen.getByLabelText('電話番号')).toBeTruthy()
    expect(screen.queryByLabelText('生年月日')).toBeNull()
  })

  it('needsBirthDate の候補を選び ON にすると生年月日欄が出て電話番号欄は出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.click(screen.getByRole('radio', { name: '鈴木 一郎' }))
    toggleCircle()
    expect(screen.getByLabelText('生年月日')).toBeTruthy()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
  })

  it('needs が両方 false の候補を選び ON にしても電話・生年月日は出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.click(screen.getByRole('radio', { name: '佐藤 花子' }))
    toggleCircle()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
    expect(screen.queryByLabelText('生年月日')).toBeNull()
  })

  it('候補未選択のまま ON にしても電話・生年月日は出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    toggleCircle()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
    expect(screen.queryByLabelText('生年月日')).toBeNull()
  })

  it('needsPhone の候補を選んでも OFF のままなら電話番号欄は出ない', () => {
    const action = vi.fn()
    render(<RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />)
    fireEvent.click(screen.getByRole('radio', { name: '山田 太郎' }))
    expect(screen.queryByLabelText('電話番号')).toBeNull()
  })

  it('送信すると FormData に userId・isCircleMember・facultyKind・faculty・schoolYear・phone が渡り、検索欄の値は渡らない', async () => {
    const action = vi.fn<(prev: RosterClaimFormState, fd: FormData) => Promise<RosterClaimFormState>>()
    action.mockResolvedValue({})
    const { container } = render(
      <RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />,
    )
    fireEvent.change(screen.getByLabelText('会員を検索'), { target: { value: '山田' } })
    fireEvent.click(screen.getByRole('radio', { name: '山田 太郎' }))
    toggleCircle()
    fireEvent.click(screen.getByRole('radio', { name: '大学院' }))
    fireEvent.change(screen.getByLabelText('学部等名'), { target: { value: '情報科学院' } })
    fireEvent.change(screen.getByLabelText('学年'), { target: { value: '修士1年' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-1234-5678' } })
    submit(container)

    await waitFor(() => expect(action).toHaveBeenCalled())
    const fd = lastFormData(action)
    expect(fd.get('userId')).toBe('u1')
    expect(fd.get('isCircleMember')).toBe('on')
    expect(fd.get('facultyKind')).toBe('graduate')
    expect(fd.get('faculty')).toBe('情報科学院')
    expect(fd.get('schoolYear')).toBe('修士1年')
    expect(fd.get('phone')).toBe('090-1234-5678')
    expect(fd.get('query')).toBeNull()
    expect(fd.get('roster-search')).toBeNull()
  })

  it('action がエラーを返すと role=alert に文言が出て、選択・チェック・学部等名の値が保持される', async () => {
    const action = vi.fn<(prev: RosterClaimFormState, fd: FormData) => Promise<RosterClaimFormState>>()
    action.mockResolvedValue({ error: 'エラーです' })
    const { container } = render(
      <RosterClaimForm action={action} candidates={CANDIDATES} submitLabel="続ける" />,
    )
    fireEvent.click(screen.getByRole('radio', { name: '山田 太郎' }))
    toggleCircle()
    fireEvent.change(screen.getByLabelText('学部等名'), { target: { value: '情報科学院' } })
    fireEvent.change(screen.getByLabelText('学年'), { target: { value: '修士1年' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-1234-5678' } })
    submit(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('エラーです')
    expect((screen.getByRole('radio', { name: '山田 太郎' }) as HTMLInputElement).checked).toBe(true)
    expect(
      (screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }) as HTMLInputElement).checked,
    ).toBe(true)
    expect((screen.getByLabelText('学部等名') as HTMLInputElement).value).toBe('情報科学院')
  })
})
