import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Step3Mail } from './Step3Mail'

const baseProps = {
  attachmentFilename: '【北海道大学かるた会】第３回青森大会参加申込書.xlsx',
  memberCount: 15,
  toEmail: 'aomorikaruta@yahoo.co.jp',
  toSource: 'template' as const,
  subject: '青森大会申込み（北海道大学かるた会）',
  subjectSource: 'default' as const,
  attachmentFilenameSource: 'default' as const,
  body: '本文',
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSubmit: vi.fn(),
  submitting: false,
}

describe('Step3Mail — 出所バッジ・編集可能・CTA注記（AC-12, AC-13）', () => {
  it('宛先バッジ「申込書から抽出」が出る', () => {
    const { container } = render(<Step3Mail {...baseProps} toSource="template" />)
    expect(container.textContent).toContain('申込書から抽出')
  })

  it('宛先バッジ「案内メールの差出人」が出る（toSource: sourceMail）', () => {
    const { container } = render(<Step3Mail {...baseProps} toSource="sourceMail" />)
    expect(container.textContent).toContain('案内メールの差出人')
  })

  it('宛先バッジは toSource が null なら出ない', () => {
    const { container } = render(<Step3Mail {...baseProps} toSource={null} toEmail="" />)
    expect(container.textContent).not.toContain('申込書から抽出')
    expect(container.textContent).not.toContain('案内メールの差出人')
  })

  it('件名バッジ「定型」が出る（主催者指定が無い場合）', () => {
    const { container } = render(<Step3Mail {...baseProps} />)
    expect(container.textContent).toContain('定型')
  })

  it('主催者指定を AI 抽出したときは件名・ファイル名に「主催者指定を抽出」が出る（AC-13）', () => {
    const { container } = render(
      <Step3Mail {...baseProps} subjectSource="organizer" attachmentFilenameSource="organizer" />,
    )
    expect(container.textContent).toContain('主催者指定を抽出')
    expect(container.textContent).not.toContain('定型')
  })

  it('宛先バッジ「主催者指定を抽出」が出る（toSource: ai）', () => {
    const { container } = render(<Step3Mail {...baseProps} toSource="ai" />)
    expect(container.textContent).toContain('主催者指定を抽出')
  })

  it('宛先・件名・ファイル名・本文は編集でき onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<Step3Mail {...baseProps} onChange={onChange} />)

    fireEvent.change(screen.getByDisplayValue('aomorikaruta@yahoo.co.jp'), {
      target: { value: 'new@example.com' },
    })
    expect(onChange).toHaveBeenCalledWith({ toEmail: 'new@example.com' })

    fireEvent.change(screen.getByDisplayValue('青森大会申込み（北海道大学かるた会）'), {
      target: { value: '件名変更' },
    })
    expect(onChange).toHaveBeenCalledWith({ subject: '件名変更' })

    fireEvent.change(screen.getByDisplayValue(baseProps.attachmentFilename), {
      target: { value: 'renamed.xlsx' },
    })
    expect(onChange).toHaveBeenCalledWith({ attachmentFilename: 'renamed.xlsx' })

    fireEvent.change(screen.getByDisplayValue('本文'), { target: { value: '本文変更' } })
    expect(onChange).toHaveBeenCalledWith({ body: '本文変更' })
  })

  it('CTA 直下に「送信はされません」の注記が常設される', () => {
    render(<Step3Mail {...baseProps} />)
    expect(
      screen.getByText('送信はされません — 下書きを確認し、Yahoo メールから手動で送信します'),
    ).toBeTruthy()
  })

  it('作成中は CTA が「作成中…」になり無効化される', () => {
    render(<Step3Mail {...baseProps} submitting />)
    const btn = screen.getByRole('button', { name: '作成中…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
