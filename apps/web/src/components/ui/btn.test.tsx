import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Btn } from './btn'

describe('Btn', () => {
  it('kind=primary で bg-brand クラスを含む', () => {
    render(<Btn kind="primary">送信</Btn>)
    const btn = screen.getByRole('button', { name: '送信' })
    expect(btn.className).toContain('bg-brand')
  })

  it('disabled 属性が HTML button に pass-through される', () => {
    render(
      <Btn kind="primary" disabled>
        無効
      </Btn>,
    )
    const btn = screen.getByRole('button', { name: '無効' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('block=true で w-full クラスを含む', () => {
    render(
      <Btn kind="secondary" block>
        フル幅
      </Btn>,
    )
    const btn = screen.getByRole('button', { name: 'フル幅' })
    expect(btn.className).toContain('w-full')
  })
})
