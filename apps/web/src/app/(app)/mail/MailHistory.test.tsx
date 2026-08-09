import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MailHistory } from './MailHistory'
import type { HistoryRow } from '@/lib/mail-history'

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    kind: 'linked',
    at: new Date('2026-08-02T00:00:00+09:00'),
    segments: [{ type: 'text', value: '対応不要として処理' }],
    detail: null,
    note: null,
    summarySegments: [{ type: 'text', value: '対応不要として処理' }],
    ...overrides,
  }
}

describe('MailHistory', () => {
  it('AC-19: 履歴が日時昇順（渡された順）に描画される', () => {
    const rows: HistoryRow[] = [
      row({
        at: new Date('2026-08-01T00:00:00+09:00'),
        segments: [{ type: 'text', value: '先の行' }],
      }),
      row({
        at: new Date('2026-08-02T00:00:00+09:00'),
        segments: [{ type: 'text', value: '後の行' }],
      }),
    ]
    render(<MailHistory rows={rows} />)

    const container = screen.getByTestId('mail-history')
    const text = container.textContent ?? ''
    expect(text.indexOf('先の行')).toBeLessThan(text.indexOf('後の行'))
  })

  it('AC-20: 大会名が /events/[id] リンクになっている', () => {
    const rows: HistoryRow[] = [
      row({
        segments: [
          { type: 'eventLink', eventId: 46, label: '第46回九段大会AB' },
          { type: 'text', value: ' の案内として処理' },
        ],
      }),
    ]
    render(<MailHistory rows={rows} />)

    const link = screen.getByText('第46回九段大会AB').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/events/46')
  })

  it('AC-18: at=null の行では data-testid="mail-history" 内に日付文字列（年/月）が無い', () => {
    const rows: HistoryRow[] = [
      row({
        at: null,
        segments: [{ type: 'text', value: '対応不要として処理済み' }],
        note: '処理日時の記録がありません',
      }),
    ]
    render(<MailHistory rows={rows} />)

    const container = screen.getByTestId('mail-history')
    expect(container.textContent).not.toMatch(/年/)
    expect(container.textContent).not.toMatch(/月/)
  })

  it('at=null 行のドットは bg-border-strong で、日付見出しが無い', () => {
    const rows: HistoryRow[] = [row({ at: null })]
    const { container } = render(<MailHistory rows={rows} />)

    const dot = container.querySelector('span.rounded-full')
    expect(dot).not.toBeNull()
    expect(dot!.className).toContain('bg-border-strong')
    expect(dot!.className).not.toContain('bg-brand')
  })

  it('at がある行のドットは bg-brand で、日付見出しが出る', () => {
    const rows: HistoryRow[] = [row({ at: new Date('2026-08-02T00:00:00+09:00') })]
    const { container } = render(<MailHistory rows={rows} />)

    const dot = container.querySelector('span.rounded-full')
    expect(dot!.className).toContain('bg-brand')
    expect(screen.getByText('2026年8月2日')).toBeTruthy()
  })

  it('note が出る', () => {
    const rows: HistoryRow[] = [row({ at: null, note: '処理日時の記録がありません' })]
    render(<MailHistory rows={rows} />)
    expect(screen.getByText('処理日時の記録がありません')).toBeTruthy()
  })

  it('detail が出る', () => {
    const rows: HistoryRow[] = [
      row({
        segments: [
          { type: 'eventLink', eventId: 1, label: '第46回九段大会AB' },
          { type: 'text', value: ' の連絡としてLINEグループへ配信' },
        ],
        detail: '（本文と添付2件）',
      }),
    ]
    render(<MailHistory rows={rows} />)
    expect(screen.getByText('（本文と添付2件）')).toBeTruthy()
  })

  it('最終行にレール線（tlline 相当）が無い', () => {
    const rows: HistoryRow[] = [
      row({ segments: [{ type: 'text', value: '1行目' }] }),
      row({ segments: [{ type: 'text', value: '2行目' }] }),
    ]
    const { container } = render(<MailHistory rows={rows} />)

    // レール = w-[13px] のラッパー。最終行のラッパーはドットのみで線を持たない。
    const rails = container.querySelectorAll('.w-\\[13px\\]')
    expect(rails).toHaveLength(2)
    expect(rails[0]!.children).toHaveLength(2) // dot + line
    expect(rails[1]!.children).toHaveLength(1) // dot only
  })
})
