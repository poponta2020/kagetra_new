import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RosterSection, type RosterView } from './RosterSection'

vi.mock('../actions', () => ({ uploadRoster: vi.fn() }))

function roster(id: number, version: number, rawName: string): RosterView {
  return {
    id,
    version,
    rosterType: 'confirmed',
    publishedAt: null,
    entries: [
      {
        id,
        rawName,
        grade: 'A',
        rawAffiliation: null,
        status: 'confirmed',
        userId: null,
        user: null,
      },
    ],
  }
}

describe('RosterSection', () => {
  it('同種の有効版が複数あっても version が最大の名簿だけを表示する', () => {
    render(
      <RosterSection
        eventId={1}
        kind="individual"
        rosters={[
          roster(1, 1, '旧版太郎'),
          roster(2, 3, '最新版花子'),
          roster(3, 2, '中間次郎'),
        ]}
        isAdmin={false}
        currentUserId={null}
      />,
    )

    expect(screen.getByText('最新版花子')).toBeTruthy()
    expect(screen.queryByText('旧版太郎')).toBeNull()
    expect(screen.queryByText('中間次郎')).toBeNull()
  })
})
