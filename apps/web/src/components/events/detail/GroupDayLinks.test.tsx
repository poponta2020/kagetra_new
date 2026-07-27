import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupDayLinks } from './GroupDayLinks'

/** entry-groups タスク4 (AC-16): 同じ申込グループの日リンク。 */
describe('GroupDayLinks', () => {
  it('シングルトングループ（1件）では何も描画しない', () => {
    const { container } = render(
      <GroupDayLinks
        siblings={[
          { id: 1, title: '単日大会', eventDate: '2026-08-01', eligibleGrades: null, status: 'published' },
        ]}
        currentEventId={1}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('siblings が空でも何も描画しない', () => {
    const { container } = render(<GroupDayLinks siblings={[]} currentEventId={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('2件以上のとき各日を表示し、現在の日はリンクにせず現在地として示す（AC-16）', () => {
    render(
      <GroupDayLinks
        siblings={[
          { id: 1, title: '多摩A', eventDate: '2026-08-15', eligibleGrades: null, status: 'published' },
          { id: 2, title: '多摩B', eventDate: '2026-08-11', eligibleGrades: null, status: 'published' },
        ]}
        currentEventId={2}
      />,
    )

    expect(screen.getByText(/多摩A/)).toBeTruthy()
    expect(screen.getByText(/多摩B/)).toBeTruthy()
    expect(screen.getByText(/8\/15/)).toBeTruthy()
    expect(screen.getByText(/8\/11/)).toBeTruthy()

    // 現在見ている日（id=2, 多摩B）はリンクではない。
    expect(screen.queryByRole('link', { name: /多摩B/ })).toBeNull()
    // 他方（id=1, 多摩A）は /events/1 へのリンク。
    const link = screen.getByRole('link', { name: /多摩A/ })
    expect(link.getAttribute('href')).toBe('/events/1')
  })
})
