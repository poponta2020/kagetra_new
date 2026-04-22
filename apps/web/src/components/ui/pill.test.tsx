import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pill } from './pill'

describe('Pill', () => {
  it('tone=success でラベルをレンダーし、bg-success-bg クラスを含む', () => {
    render(<Pill tone="success">公開</Pill>)
    const el = screen.getByText('公開')
    expect(el.className).toContain('bg-success-bg')
    expect(el.className).toContain('text-success-fg')
  })

  it('size=sm で text-[10px] クラスを含む', () => {
    render(
      <Pill tone="neutral" size="sm">
        tiny
      </Pill>,
    )
    const el = screen.getByText('tiny')
    expect(el.className).toContain('text-[10px]')
  })
})
