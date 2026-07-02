import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { EventListClient } from './EventListClient'
import type { EventListItem } from './event-list-utils'

const TODAY = '2026-07-10'

const item = (
  over: Partial<EventListItem> & { id: number },
): EventListItem => ({
  title: `イベント${over.id}`,
  eventDate: '2026-08-01',
  internalDeadline: null,
  status: 'published',
  canApply: true,
  attendCount: 0,
  chipSurnames: [],
  ...over,
})

/** Ordered list of event ids as rendered (row links point at /events/{id}). */
const renderedOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('a')).map(
    (a) => a.getAttribute('href')?.replace('/events/', '') ?? '',
  )

const BASE: EventListItem[] = [
  item({ id: 1, title: 'アルファ', eventDate: '2026-08-01', internalDeadline: '2026-07-20' }),
  item({ id: 2, title: 'ブラボー', eventDate: '2026-07-15', internalDeadline: null, canApply: false }),
  item({ id: 3, title: 'チャーリー', eventDate: '2026-07-10', internalDeadline: '2026-07-05', status: 'cancelled' }),
  item({ id: 4, title: 'デルタ', eventDate: '2026-07-25', internalDeadline: '2026-07-11' }),
]

describe('EventListClient — ソート', () => {
  it('既定は締切日順（null は末尾）', () => {
    const { container } = render(<EventListClient items={BASE} todayStr={TODAY} />)
    // deadlines: 3=07-05, 4=07-11, 1=07-20, 2=null(last)
    expect(renderedOrder(container)).toEqual(['3', '4', '1', '2'])
    // 締切日順タブが選択状態
    expect(screen.getByRole('tab', { name: '締切日順' }).getAttribute('aria-selected')).toBe('true')
  })

  it('「開催日順」に切替えると eventDate 昇順になる', () => {
    const { container } = render(<EventListClient items={BASE} todayStr={TODAY} />)
    fireEvent.click(screen.getByRole('tab', { name: '開催日順' }))
    // eventDate: 3=07-10, 2=07-15, 4=07-25, 1=08-01
    expect(renderedOrder(container)).toEqual(['3', '2', '4', '1'])
    expect(screen.getByRole('tab', { name: '開催日順' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('EventListClient — 申込可能フィルタ', () => {
  it('スイッチ ON で canApply=true のみ残す（既定は全件）', () => {
    const { container } = render(<EventListClient items={BASE} todayStr={TODAY} />)
    expect(renderedOrder(container)).toHaveLength(4)
    fireEvent.click(screen.getByRole('switch', { name: '申込可能のみ' }))
    // id2 は canApply=false なので消える。締切日順のまま。
    expect(renderedOrder(container)).toEqual(['3', '4', '1'])
    expect(screen.getByRole('switch', { name: '申込可能のみ' }).getAttribute('aria-checked')).toBe('true')
  })

  it('フィルタ ON で 0 件なら専用の空表示', () => {
    const none = [item({ id: 9, canApply: false })]
    render(<EventListClient items={none} todayStr={TODAY} />)
    fireEvent.click(screen.getByRole('switch', { name: '申込可能のみ' }))
    expect(screen.getByText('申込可能な大会はありません')).toBeTruthy()
  })
})

describe('EventListClient — 締切 tone', () => {
  const tones: EventListItem[] = [
    item({ id: 1, title: '本日締切', internalDeadline: '2026-07-10' }), // today
    item({ id: 2, title: '間近', internalDeadline: '2026-07-11' }), // soon (1日)
    item({ id: 3, title: '通常', internalDeadline: '2026-07-20' }), // normal (10日)
    item({ id: 4, title: '超過', internalDeadline: '2026-07-05' }), // past
    item({ id: 5, title: 'なし', internalDeadline: null }), // none
  ]

  it('本日＝朱・太字', () => {
    render(<EventListClient items={tones} todayStr={TODAY} />)
    const el = screen.getByText('本日')
    expect(el.className).toContain('text-accent-fg')
    expect(el.className).toContain('font-bold')
  })

  it('1〜3日＝あとN日・太字（soon）', () => {
    render(<EventListClient items={tones} todayStr={TODAY} />)
    const el = screen.getByText('あと1日')
    expect(el.className).toContain('font-bold')
  })

  it('4日以上＝あとN日・通常（normal, ink-2）', () => {
    render(<EventListClient items={tones} todayStr={TODAY} />)
    const el = screen.getByText('あと10日')
    expect(el.className).toContain('text-ink-2')
  })

  it('超過＝締切済、締切なし＝ダッシュ', () => {
    render(<EventListClient items={tones} todayStr={TODAY} />)
    expect(screen.getByText('締切済')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    // 「締切」ラベルは各行に前置される
    expect(screen.getAllByText('締切').length).toBe(tones.length)
  })
})

describe('EventListClient — 参加者チップ / 中止 / 空', () => {
  it('参加数＋苗字チップ最大5＋他N名', () => {
    const rich = [
      item({
        id: 1,
        title: '大会',
        internalDeadline: '2026-07-20',
        attendCount: 7,
        chipSurnames: ['山田', '鈴木', '佐藤', '高橋', '田中'],
      }),
    ]
    const { container } = render(<EventListClient items={rich} todayStr={TODAY} />)
    const row = container.querySelector('li') as HTMLElement
    expect(within(row).getByText('参加 7名')).toBeTruthy()
    expect(within(row).getByText('山田')).toBeTruthy()
    expect(within(row).getByText('田中')).toBeTruthy()
    // 7 - 5 = 2 名を「他2名」に畳む
    expect(within(row).getByText('他2名')).toBeTruthy()
  })

  it('参加0名はチップなしで「参加 0名」のみ（他N名は出さない）', () => {
    const zero = [item({ id: 1, internalDeadline: '2026-07-20', attendCount: 0, chipSurnames: [] })]
    render(<EventListClient items={zero} todayStr={TODAY} />)
    expect(screen.getByText('参加 0名')).toBeTruthy()
    expect(screen.queryByText(/^他\d+名$/)).toBeNull()
  })

  it('中止行は 中止 ピル＋タイトル淡色', () => {
    const cancelled = [
      item({ id: 1, title: '中止大会', status: 'cancelled', internalDeadline: '2026-07-20' }),
    ]
    render(<EventListClient items={cancelled} todayStr={TODAY} />)
    expect(screen.getByText('中止')).toBeTruthy()
    expect(screen.getByText('中止大会').className).toContain('text-ink-meta')
  })

  it('全体 0 件は現状文言（コントロール非表示）', () => {
    render(<EventListClient items={[]} todayStr={TODAY} />)
    expect(screen.getByText('現在のイベントはありません')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('行タップは /events/{id} へ', () => {
    const one = [item({ id: 42, title: '飛び先', internalDeadline: '2026-07-20' })]
    render(<EventListClient items={one} todayStr={TODAY} />)
    expect(screen.getByText('飛び先').closest('a')?.getAttribute('href')).toBe('/events/42')
  })
})
