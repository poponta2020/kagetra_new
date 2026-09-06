import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UpdateTravelFlagsState } from './actions'

const updateMemberTravelFlagsMock = vi.fn<
  (prev: UpdateTravelFlagsState, fd: FormData) => Promise<UpdateTravelFlagsState>
>()

vi.mock('./actions', () => ({
  updateMemberTravelFlags: (prev: UpdateTravelFlagsState, fd: FormData) =>
    updateMemberTravelFlagsMock(prev, fd),
}))

const { MemberTravelFlagsSection } = await import('./member-travel-flags-section')

type Props = Parameters<typeof MemberTravelFlagsSection>[0]

function renderSection(overrides: Partial<Props> = {}) {
  const props: Props = {
    userId: 'u1',
    role: 'member',
    isTravelReportSubmitter: false,
    isCircleLeader: false,
    ...overrides,
  }
  return render(<MemberTravelFlagsSection {...props} />)
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

// requirements §7: 副連絡責任者はゲスト（role='guest'）には出さない・
// 権限にならない。サークル長のチェックはゲストにも出す（R2 に制限が無い）。
describe('MemberTravelFlagsSection', () => {
  beforeEach(() => {
    updateMemberTravelFlagsMock.mockReset()
    updateMemberTravelFlagsMock.mockResolvedValue({})
  })

  it('member: 副連絡責任者・サークル長の両方のチェックが出る', () => {
    renderSection({ role: 'member' })
    expect(screen.getByLabelText('副連絡責任者にする')).toBeTruthy()
    expect(screen.getByLabelText('サークル長にする')).toBeTruthy()
  })

  it('guest: 副連絡責任者のチェックは出ない（サークル長は出る）', () => {
    renderSection({ role: 'guest' })
    expect(screen.queryByLabelText('副連絡責任者にする')).toBeNull()
    expect(screen.getByLabelText('サークル長にする')).toBeTruthy()
  })

  it('保存で userId・isTravelReportSubmitter・isCircleLeader が FormData に渡る', async () => {
    const { container } = renderSection()
    fireEvent.click(screen.getByLabelText('副連絡責任者にする'))
    fireEvent.click(screen.getByLabelText('サークル長にする'))
    submitForm(container)

    await waitFor(() => expect(updateMemberTravelFlagsMock).toHaveBeenCalledTimes(1))
    const fd = updateMemberTravelFlagsMock.mock.calls[0]?.[1]
    expect(fd?.get('userId')).toBe('u1')
    expect(fd?.get('isTravelReportSubmitter')).toBe('on')
    expect(fd?.get('isCircleLeader')).toBe('on')
  })

  it('エラーは role=alert で表示される（サークル長重複など）', async () => {
    updateMemberTravelFlagsMock.mockResolvedValue({
      error: 'サークル長は既に他の会員に設定されています。先に外してから設定してください',
    })
    const { container } = renderSection()
    submitForm(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('サークル長は既に他の会員')
  })

  it('成功時は role=status で保存メッセージが表示される', async () => {
    updateMemberTravelFlagsMock.mockResolvedValue({ success: true })
    const { container } = renderSection()
    submitForm(container)

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('保存しました')
  })
})
