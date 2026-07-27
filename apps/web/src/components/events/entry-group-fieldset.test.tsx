import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EntryGroupFieldset } from './entry-group-fieldset'

/**
 * entry-groups タスク2 / AC-18: 「申込グループ」欄で単独化・既存グループへの合流ができる
 * UI 側の表示・切り替えを検証する（実際の付け替え・空グループ削除は Server Action 側
 * `applyEntryGroupChange` / `deleteGroupIfEmpty` の DB テストで固定済み）。
 */

const SIBLINGS = [
  { id: 1, title: '多摩A', eventDate: '2026-07-11', status: 'published' as const },
  { id: 2, title: '多摩B', eventDate: '2026-07-12', status: 'cancelled' as const },
]

const CANDIDATES = [
  { groupId: 10, name: '秋田ABCD', representativeEventDate: '2026-08-01', eventCount: 4 },
  { groupId: 11, name: '大学生選手権', representativeEventDate: '2026-09-01', eventCount: 3 },
]

describe('EntryGroupFieldset', () => {
  it('現在のグループの所属日一覧を表示する（中止マーク付き）', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    expect(screen.getByText(/多摩A/)).toBeTruthy()
    expect(screen.getByText(/多摩B/)).toBeTruthy()
    expect(screen.getByText(/（中止）/)).toBeTruthy()
  })

  it('既定は「このまま」で合流先候補は表示しない', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    const keep = screen.getByRole('radio', { name: /このまま/ }) as HTMLInputElement
    expect(keep.checked).toBe(true)
    expect(screen.queryByText(/秋田ABCD/)).toBeNull()
  })

  it('「既存グループへ合流」を選ぶと合流先候補が表示される', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    fireEvent.click(screen.getByRole('radio', { name: /既存グループへ合流/ }))
    expect(screen.getByText(/秋田ABCD/)).toBeTruthy()
    expect(screen.getByText(/大学生選手権/)).toBeTruthy()
  })

  it('合流先候補は entry_group_target_id という name の radio で送信される', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    fireEvent.click(screen.getByRole('radio', { name: /既存グループへ合流/ }))
    const target = screen.getByDisplayValue('10') as HTMLInputElement
    expect(target.name).toBe('entry_group_target_id')
    expect(target.type).toBe('radio')
  })

  it('テキストフィルタで合流先候補を絞り込める', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    fireEvent.click(screen.getByRole('radio', { name: /既存グループへ合流/ }))
    fireEvent.change(screen.getByPlaceholderText('大会名で絞り込み'), {
      target: { value: '秋田' },
    })
    expect(screen.getByText(/秋田ABCD/)).toBeTruthy()
    expect(screen.queryByText(/大学生選手権/)).toBeNull()
  })

  it('「単独化」を選んでも合流先候補は表示しない', () => {
    render(<EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />)
    fireEvent.click(screen.getByRole('radio', { name: /単独化/ }))
    expect(screen.queryByText(/秋田ABCD/)).toBeNull()
  })

  it('entry_group_action の各選択肢が正しい value を持つ', () => {
    const { container } = render(
      <EntryGroupFieldset siblings={SIBLINGS} mergeCandidates={CANDIDATES} />,
    )
    const radios = Array.from(
      container.querySelectorAll('input[name="entry_group_action"]'),
    ) as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['keep', 'standalone', 'merge'])
  })
})
