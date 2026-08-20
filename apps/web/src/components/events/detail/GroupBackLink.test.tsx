import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupBackLink } from './GroupBackLink'

/** entry-group-page タスク4 (AC-29): 日ページのグループ導線。 */
describe('GroupBackLink', () => {
  it('固定文言のリンクが出る（大会名を含まない）', () => {
    render(<GroupBackLink entryGroupId={1} groupName={null} />)

    const link = screen.getByRole('link', { name: '‹ 大会全体（申込・名簿）' })
    expect(link).toBeTruthy()
  })

  it('groupName=null（シングルトン）でもリンクが出る（AC-29 の肝）', () => {
    render(<GroupBackLink entryGroupId={1} groupName={null} />)

    expect(
      screen.getByRole('link', { name: '‹ 大会全体（申込・名簿）' }),
    ).toBeTruthy()
    expect(screen.queryByText('杉並AB')).toBeNull()
  })

  it('groupName を渡すとリンクの右に薄く添えられる', () => {
    render(<GroupBackLink entryGroupId={1} groupName="杉並AB" />)

    expect(
      screen.getByRole('link', { name: '‹ 大会全体（申込・名簿）' }),
    ).toBeTruthy()
    expect(screen.getByText('杉並AB')).toBeTruthy()
  })

  it('href が /admin/entries/[groupId] になる', () => {
    render(<GroupBackLink entryGroupId={42} groupName="多摩AB" />)

    const link = screen.getByRole('link', { name: '‹ 大会全体（申込・名簿）' })
    expect(link.getAttribute('href')).toBe('/admin/entries/42')
  })
})
