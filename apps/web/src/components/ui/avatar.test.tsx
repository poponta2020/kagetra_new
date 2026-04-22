import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Avatar } from './avatar'
import { AVATAR_COLORS } from './avatar-colors'

describe('Avatar', () => {
  it('member={id:0, name:"田中"} で先頭の一文字 "田" を表示', () => {
    const { container } = render(<Avatar member={{ id: 0, name: '田中' }} />)
    expect(container.textContent).toBe('田')
  })

  it('id=0 と id=8 で同じ色が選ばれる (8色循環)', () => {
    expect(AVATAR_COLORS).toHaveLength(8)
    const { container: c0 } = render(
      <Avatar member={{ id: 0, name: 'A' }} />,
    )
    const { container: c8 } = render(
      <Avatar member={{ id: 8, name: 'A' }} />,
    )
    const el0 = c0.firstChild as HTMLElement
    const el8 = c8.firstChild as HTMLElement
    expect(el0.style.background).toBe(el8.style.background)
    expect(el0.style.color).toBe(el8.style.color)
  })

  it('member=null で null を返す (ノード描画なし)', () => {
    const { container } = render(<Avatar member={null} />)
    expect(container.firstChild).toBeNull()
  })
})
