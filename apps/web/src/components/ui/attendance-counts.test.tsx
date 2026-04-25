import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttendanceCounts } from './attendance-counts'

// Domain rule: unanswered users are folded into the non-attending count,
// so callers pass a single `nonAttendingCount` (explicit-false + unanswered).
const ev = {
  attendIds: [1, 2, 3],
  nonAttendingCount: 9,
}

describe('AttendanceCounts', () => {
  it('variant=cards でカードが2つ並び、参加/不参加ラベルと数値が表示される', () => {
    const { container } = render(<AttendanceCounts ev={ev} variant="cards" />)
    const cards = container.querySelectorAll('[data-card]')
    expect(cards).toHaveLength(2)
    expect(screen.getByText('参加')).toBeTruthy()
    expect(screen.getByText('不参加')).toBeTruthy()
    expect(screen.queryByText('未回答')).toBeNull()
    // Counts rendered (3, 9)
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
  })

  it('variant=cards は既定値で、省略時も 2 カード表示', () => {
    const { container } = render(<AttendanceCounts ev={ev} />)
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2)
  })

  it('variant=bar でバーセグメントと凡例が表示され、凡例に各カウントが含まれる', () => {
    const { container } = render(<AttendanceCounts ev={ev} variant="bar" />)
    // Two non-zero segments expected
    const segs = container.querySelectorAll('[data-segment]')
    expect(segs).toHaveLength(2)
    // Legend lines include counts
    expect(screen.getByText(/参加\s*3/)).toBeTruthy()
    expect(screen.getByText(/不参加\s*9/)).toBeTruthy()
    expect(screen.queryByText(/未回答/)).toBeNull()
  })

  it('variant=bar で count=0 のセグメントは描画されない', () => {
    const { container } = render(
      <AttendanceCounts
        ev={{ attendIds: [1], nonAttendingCount: 0 }}
        variant="bar"
      />,
    )
    const segs = container.querySelectorAll('[data-segment]')
    expect(segs).toHaveLength(1)
    expect(segs[0]?.getAttribute('data-segment')).toBe('attend')
  })
})
