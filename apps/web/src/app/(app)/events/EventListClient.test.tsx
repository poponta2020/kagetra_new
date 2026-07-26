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
  attendeeSurnames: [],
  viewerAttending: false,
  ...over,
})

/** Ordered list of event ids as rendered (row links point at /events/{id}). */
const renderedOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('a')).map(
    (a) => a.getAttribute('href')?.replace('/events/', '') ?? '',
  )

/** The row `<li>` whose link text contains `title` (each row is one `<li><a>...`). */
const rowByTitle = (container: HTMLElement, title: string): HTMLElement =>
  (screen.getByText(title).closest('li') as HTMLElement) ?? container

/** The 3px color bar is the first DOM child of the row's `<a>`. */
const barOf = (row: HTMLElement): HTMLElement =>
  row.querySelector('a > span:first-child') as HTMLElement

const BASE: EventListItem[] = [
  item({ id: 1, title: 'アルファ', eventDate: '2026-08-01', internalDeadline: '2026-07-20' }),
  item({ id: 2, title: 'ブラボー', eventDate: '2026-07-15', internalDeadline: null, canApply: false }),
  item({
    id: 3,
    title: 'チャーリー',
    eventDate: '2026-07-10',
    internalDeadline: '2026-07-05',
    status: 'cancelled',
    // 締切超過（07-05 < TODAY 07-10）だが自分が attend=true なので可視のまま
    // （AC-2）。ソート回帰テストの並び順を維持するために必要。
    viewerAttending: true,
  }),
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

describe('EventListClient — 可視フィルタ（締切超過の非表示・AC-1/AC-2/AC-13）', () => {
  it('締切超過（viewerAttending=false）の行は表示されない', () => {
    const rows = [
      item({ id: 1, title: '通常', internalDeadline: '2026-07-20' }),
      item({ id: 2, title: '超過・未回答', internalDeadline: '2026-07-05' }),
    ]
    const { container } = render(<EventListClient items={rows} todayStr={TODAY} />)
    expect(renderedOrder(container)).toEqual(['1'])
    expect(screen.queryByText('超過・未回答')).toBeNull()
  })

  it('締切超過でも viewerAttending=true の行は表示され、「締切済」・帯は砂になる', () => {
    const rows = [
      item({
        id: 1,
        title: '超過・回答済',
        internalDeadline: '2026-07-05',
        canApply: true,
        viewerAttending: true,
      }),
    ]
    const { container } = render(<EventListClient items={rows} todayStr={TODAY} />)
    expect(renderedOrder(container)).toEqual(['1'])
    const row = rowByTitle(container, '超過・回答済')
    expect(within(row).getByText('締切済')).toBeTruthy()
    expect(barOf(row).className).toContain('bg-border')
    expect(barOf(row).className).not.toContain('bg-brand')
  })

  it('items は非空でも全行が締切超過なら「現在のイベントはありません」（フィルタ0件文言とは別）', () => {
    const rows = [item({ id: 1, title: '超過のみ', internalDeadline: '2026-07-05' })]
    render(<EventListClient items={rows} todayStr={TODAY} />)
    expect(screen.getByText('現在のイベントはありません')).toBeTruthy()
    expect(screen.queryByText('申込可能な大会はありません')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('EventListClient — 色帯（AC-8/AC-9）', () => {
  it('canApply かつ 中止でない かつ 締切超過でない行だけ藍、それ以外は砂', () => {
    const rows = [
      item({ id: 1, title: '開放', internalDeadline: '2026-07-20', canApply: true }),
      item({ id: 2, title: '級対象外', internalDeadline: '2026-07-20', canApply: false }),
      // タイトルは「中止」以外にする（中止ピルのラベルと getByText が衝突する）。
      item({
        id: 3,
        title: '中止イベント',
        internalDeadline: '2026-07-20',
        canApply: true,
        status: 'cancelled',
      }),
      item({
        id: 4,
        title: '締切超過(回答済)',
        internalDeadline: '2026-07-05',
        canApply: true,
        viewerAttending: true,
      }),
    ]
    const { container } = render(<EventListClient items={rows} todayStr={TODAY} />)

    const open = barOf(rowByTitle(container, '開放'))
    expect(open.className).toContain('bg-brand')
    expect(open.className).not.toContain('bg-border')

    for (const title of ['級対象外', '中止イベント', '締切超過(回答済)']) {
      const bar = barOf(rowByTitle(container, title))
      expect(bar.className).toContain('bg-border')
      expect(bar.className).not.toContain('bg-brand')
    }
  })
})

describe('EventListClient — 締切 tone', () => {
  const tones: EventListItem[] = [
    item({ id: 1, title: '本日締切', internalDeadline: '2026-07-10' }), // today
    item({ id: 2, title: '間近', internalDeadline: '2026-07-11' }), // soon (1日)
    item({ id: 3, title: '通常', internalDeadline: '2026-07-20' }), // normal (10日)
    // past（超過）は viewerAttending=true で可視のまま残す（AC-2）
    item({ id: 4, title: '超過', internalDeadline: '2026-07-05', viewerAttending: true }),
    item({ id: 5, title: 'なし', internalDeadline: null }), // none
  ]

  it('本日＝朱の塗りピル・白字（数字なし）', () => {
    const { container } = render(<EventListClient items={tones} todayStr={TODAY} />)
    const row = rowByTitle(container, '本日締切')
    const val = within(row).getByText('本日')
    expect(val.className).toContain('bg-accent')
    expect(val.className).toContain('text-ink-on-brand')
    // 「締切」ラベルも当日だけ accent-fg になる
    const lab = within(row).getByText('締切')
    expect(lab.className).toContain('text-accent-fg')
  })

  it('1〜3日＝数字だけ19pxに拡大・色は墨（朱にしない）', () => {
    const { container } = render(<EventListClient items={tones} todayStr={TODAY} />)
    const row = rowByTitle(container, '間近')
    const digit = within(row).getByText('1')
    expect(digit.className).toContain('text-[19px]')
    expect(digit.className).not.toContain('accent')
  })

  it('4日以上＝数字15px・通常色（ink-2）', () => {
    const { container } = render(<EventListClient items={tones} todayStr={TODAY} />)
    const row = rowByTitle(container, '通常')
    const digit = within(row).getByText('10')
    expect(digit.className).toContain('text-[15px]')
    expect(digit.className).toContain('text-ink-2')
  })

  it('超過＝締切済、締切なし＝ダッシュ', () => {
    render(<EventListClient items={tones} todayStr={TODAY} />)
    expect(screen.getByText('締切済')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    // 「締切」ラベルは各行に前置される
    expect(screen.getAllByText('締切').length).toBe(tones.length)
  })
})

describe('EventListClient — 参加者（AC-5/AC-6）', () => {
  it('参加者0名は meta 行ごと非表示（「参加」の文字列も出ない）', () => {
    const { container } = render(
      <EventListClient
        items={[item({ id: 1, title: '無人', internalDeadline: '2026-07-20', attendCount: 0, attendeeSurnames: [] })]}
        todayStr={TODAY}
      />,
    )
    const row = rowByTitle(container, '無人')
    expect(within(row).queryByText(/^参加/)).toBeNull()
    expect(within(row).queryByText('名')).toBeNull()
  })

  it('参加者8名でも全員表示され「他N名」は出ない', () => {
    const surnames = ['中村', '小林', '加藤', '渡辺', '伊藤', '山本', '中島', '清水']
    const { container } = render(
      <EventListClient
        items={[
          item({
            id: 1,
            title: '大阪CD',
            internalDeadline: '2026-07-20',
            attendCount: 8,
            attendeeSurnames: surnames,
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    const row = rowByTitle(container, '大阪CD')
    expect(within(row).getByText('8')).toBeTruthy()
    for (const name of surnames) {
      expect(within(row).getByText(name)).toBeTruthy()
    }
    expect(within(row).queryByText(/^他\d+名$/)).toBeNull()
  })

  it('参加者1名: 人数と苗字が表示される', () => {
    const { container } = render(
      <EventListClient
        items={[
          item({
            id: 1,
            title: '東京吉野会C',
            internalDeadline: '2026-07-20',
            attendCount: 1,
            attendeeSurnames: ['鈴木'],
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    const row = rowByTitle(container, '東京吉野会C')
    expect(within(row).getByText('1')).toBeTruthy()
    expect(within(row).getByText('鈴木')).toBeTruthy()
  })
})

describe('EventListClient — 上段 DOM 順（AC-10）', () => {
  it('大会名 → 日付 → …→ 締切 の順に並ぶ', () => {
    const { container } = render(
      <EventListClient
        items={[
          item({
            id: 1,
            title: '広島CDE',
            eventDate: '2026-09-06',
            internalDeadline: '2026-07-20',
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    const titleEl = within(container).getByText('広島CDE')
    const top = titleEl.parentElement as HTMLElement
    const texts = Array.from(top.children).map((c) => c.textContent ?? '')
    expect(texts[0]).toBe('広島CDE')
    expect(texts[1]).toBe('9/6(日)')
    // 最後の子要素が締切（ラベル+値を含む）
    expect(texts[texts.length - 1]).toContain('締切')
  })
})

describe('EventListClient — 中止 / 空表示 / 遷移（回帰）', () => {
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
