import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MailSearchRow } from '@/lib/member-mail/search'
import type { HistoryRow } from '@/lib/mail-history'
import { highlightTerms, MailCard } from './MailCard'
import { formatHistorySummaryDate } from '@/lib/member-mail/format'

/**
 * member-mail-search タスク4: 一覧カード（requirements.md §3.5b・design-spec.md §3/§8）。
 */

function makeRow(overrides: Partial<MailSearchRow> = {}): MailSearchRow {
  return {
    id: 10,
    subject: 'テスト件名',
    fromName: '隠れ太郎',
    fromAddress: 'hidden@example.jp',
    receivedAt: new Date('2026-08-08T07:25:00Z'),
    triageStatus: 'processed',
    mailKind: null,
    attachments: [],
    subjectMatched: false,
    excerpt: null,
    ...overrides,
  }
}

const NO_HISTORY: HistoryRow | null = null

describe('MailCard', () => {
  it('差出人を出していない（from_address / from_name の文字列が DOM に無い）', () => {
    render(
      <MailCard
        row={makeRow({ fromName: '隠れ太郎', fromAddress: 'hidden@example.jp' })}
        historySummary={NO_HISTORY}
        terms={[]}
        from="/mail"
      />,
    )

    expect(screen.queryByText(/hidden@example\.jp/)).toBeNull()
    expect(screen.queryByText(/隠れ太郎/)).toBeNull()
  })

  it('履歴サマリ最新1行（↳）が出る', () => {
    const at = new Date('2026-08-04T00:00:00Z')
    const historySummary: HistoryRow = {
      kind: 'dismissed',
      at,
      segments: [{ type: 'text', value: '対応不要として処理' }],
      detail: null,
      note: null,
      summarySegments: [{ type: 'text', value: '対応不要として処理' }],
    }

    render(
      <MailCard row={makeRow()} historySummary={historySummary} terms={[]} from="/mail" />,
    )

    expect(screen.getByText('↳')).toBeTruthy()
    expect(screen.getByText(/対応不要として処理/)).toBeTruthy()
    expect(screen.getByText(new RegExp(formatHistorySummaryDate(at)))).toBeTruthy()
  })

  it('historySummary が null なら履歴行（↳）が出ない', () => {
    render(<MailCard row={makeRow()} historySummary={null} terms={[]} from="/mail" />)

    expect(screen.queryByText('↳')).toBeNull()
  })

  it('履歴サマリの eventLink セグメントはリンクではなく強調 span で出る', () => {
    const historySummary: HistoryRow = {
      kind: 'draft_approved',
      at: new Date('2026-08-02T00:00:00Z'),
      segments: [
        { type: 'eventLink', eventId: 1, label: '第46回九段大会AB' },
        { type: 'text', value: ' の案内として処理' },
      ],
      detail: null,
      note: null,
      summarySegments: [
        { type: 'eventLink', eventId: 1, label: '第46回九段大会AB' },
        { type: 'text', value: ' の案内として処理' },
      ],
    }

    const { container } = render(
      <MailCard row={makeRow()} historySummary={historySummary} terms={[]} from="/mail" />,
    )

    const label = screen.getByText('第46回九段大会AB')
    expect(label.closest('a')).toBeNull()
    expect(container.querySelectorAll('a').length).toBeGreaterThan(0) // カード全体のオーバーレイ Link は残る
  })

  it('抜粋は excerpt があるときだけ出て、出所（本文／）が先頭に付く', () => {
    const { rerender } = render(
      <MailCard
        row={makeRow({
          subjectMatched: false,
          excerpt: { source: 'body', attachmentFilename: null, text: 'ヒットした本文抜粋' },
        })}
        historySummary={null}
        terms={['ヒット']}
        from="/mail"
      />,
    )

    expect(screen.getByText(/本文 ／/)).toBeTruthy()
    expect(screen.getByText(/ヒットした本文抜粋/)).toBeTruthy()

    rerender(
      <MailCard row={makeRow({ excerpt: null })} historySummary={null} terms={[]} from="/mail" />,
    )
    expect(screen.queryByText(/本文 ／/)).toBeNull()
  })

  it('添付での抜粋は「添付 <ファイル名> ／」が出所になる', () => {
    render(
      <MailCard
        row={makeRow({
          excerpt: { source: 'attachment', attachmentFilename: '要項.pdf', text: '抜粋テキスト' },
        })}
        historySummary={null}
        terms={[]}
        from="/mail"
      />,
    )

    expect(screen.getByText(/添付 要項\.pdf ／/)).toBeTruthy()
  })

  it('添付チップのリンクが /mail/attachments/<id>?from=... になる', () => {
    render(
      <MailCard
        row={makeRow({
          attachments: [
            {
              id: 42,
              filename: '要項.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1000,
              extractionStatus: 'extracted',
            },
          ],
        })}
        historySummary={null}
        terms={[]}
        from="/mail?q=九段"
      />,
    )

    const chipLink = screen.getByText('要項.pdf').closest('a')
    expect(chipLink).not.toBeNull()
    expect(chipLink!.getAttribute('href')).toBe(
      `/mail/attachments/42?from=${encodeURIComponent('/mail?q=九段')}`,
    )
  })

  it('<a> の入れ子が無い（カード全体リンクと添付チップリンクが重ならない）', () => {
    const { container } = render(
      <MailCard
        row={makeRow({
          attachments: [
            {
              id: 1,
              filename: 'a.pdf',
              contentType: 'application/pdf',
              sizeBytes: 100,
              extractionStatus: 'extracted',
            },
            {
              id: 2,
              filename: 'b.xlsx',
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              sizeBytes: 200,
              extractionStatus: 'extracted',
            },
          ],
        })}
        historySummary={null}
        terms={[]}
        from="/mail"
      />,
    )

    expect(container.querySelectorAll('a a').length).toBe(0)
    // カード全体のリンクと添付チップぶんのリンクが個別に存在すること。
    expect(container.querySelectorAll('a').length).toBe(3)
  })

  // #528: カードのルートが `relative` だけ（= z-index: auto）だとスタッキング
  // コンテキストを作らず、添付チップの `z-10` がカードの外＝ページのコンテキストへ
  // 抜ける。すると `/mail` の sticky 検索バー（`sticky top-0 z-10`）と z-10 同士の
  // タイになり、DOM 順で後ろにあるチップが手前に描画されて検索バーに重なる。
  // `isolate` でカード内へ閉じ込める（内部の overlay `z-0` < チップ `z-10` は維持）。
  it('#528: カードのルートがスタッキングコンテキストを閉じている（relative + isolate）', () => {
    const { container } = render(
      <MailCard
        row={makeRow({
          attachments: [
            {
              id: 42,
              filename: '要項.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1000,
              extractionStatus: 'extracted',
            },
          ],
        })}
        historySummary={null}
        terms={[]}
        from="/mail"
      />,
    )

    const card = container.firstElementChild as HTMLElement
    const cardClasses = card.className.split(/\s+/)
    expect(cardClasses).toContain('relative')
    expect(cardClasses).toContain('isolate')

    // カード内の上下関係（オーバーレイ Link より添付チップが手前）は維持する。
    const overlay = card.querySelector('a[aria-label]') as HTMLElement
    expect(overlay.className.split(/\s+/)).toContain('z-0')
    const chipLink = screen.getByText('要項.pdf').closest('a') as HTMLElement
    expect(chipLink.className.split(/\s+/)).toContain('z-10')
  })
})

describe('highlightTerms', () => {
  it('語にマッチした部分を <mark> で囲む', () => {
    const { container } = render(<div>{highlightTerms('九段大会のご案内', ['九段'])}</div>)
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('九段')
  })

  it('大文字小文字を区別しない', () => {
    const { container } = render(<div>{highlightTerms('Result Test Mail', ['test'])}</div>)
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    // 元の大文字小文字は保持する
    expect(mark!.textContent).toBe('Test')
  })

  it('正規表現メタ文字を含む語でも壊れない', () => {
    const { container } = render(
      <div>{highlightTerms('参加費(500円)のご案内について', ['(500円)'])}</div>,
    )
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('(500円)')
  })

  it('% を含む語でも壊れない', () => {
    const { container } = render(<div>{highlightTerms('割引率50%のお知らせ', ['50%'])}</div>)
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('50%')
  })

  it('. を含む語でも壊れない', () => {
    const { container } = render(
      <div>{highlightTerms('第46回九段大会要項.pdf を添付', ['要項.pdf'])}</div>,
    )
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('要項.pdf')
  })

  it('語が無ければ素通し（ハイライトしない）', () => {
    const { container } = render(<div>{highlightTerms('件名テキスト', [])}</div>)
    expect(container.querySelector('mark')).toBeNull()
    expect(container.textContent).toBe('件名テキスト')
  })
})
