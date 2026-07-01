import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GradeDots } from './GradeDots'

describe('GradeDots', () => {
  it('存在する級ごとにドットを出す（正規順・title 付き）', () => {
    render(<GradeDots grades={['D', 'B']} />)
    expect(screen.getByTitle('B級')).toBeTruthy()
    expect(screen.getByTitle('D級')).toBeTruthy()
    // aria-label は正規順（A→E）
    expect(screen.getByLabelText('級構成 B・D')).toBeTruthy()
  })

  it('級が空なら何も描画しない', () => {
    const { container } = render(<GradeDots grades={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
