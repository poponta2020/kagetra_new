import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildEntryFlow, type EntryFlowInput } from '@/lib/events/entry-flow'
import { EntryFlow } from './EntryFlow'

/**
 * 判定ロジック自体のテストは `lib/events/entry-flow.test.ts`（AC-1〜9）にある。
 * ここは**描画**の契約だけを固定する — 忠実度チェックリストのうち EntryFlow が
 * 担う3項目（5ステップを常に描く / 数値でない「未定」は sans / 開催は完了しても
 * goal の見た目を保つ）と、朱を警告以外に使っていないこと。
 */

const BASE: EntryFlowInput = {
  internalDeadline: '2026-07-31',
  entryDeadline: '2026-08-05',
  lotteryDate: '2026-08-07',
  paymentDeadline: '2026-08-20',
  eventDate: '2026-09-06',
  entryStatus: 'not_applied',
  paymentType: 'advance',
  paymentStatus: 'unpaid',
  hasConfirmedRoster: false,
  todayStr: '2026-07-20',
}

function renderFlow(overrides: Partial<EntryFlowInput> = {}) {
  const steps = buildEntryFlow({ ...BASE, ...overrides })
  return render(<EntryFlow steps={steps} />)
}

/** ラベル文字列から、そのステップのラッパー要素（`.fs` 相当）を引く。 */
function stepEl(label: string): HTMLElement {
  const el = screen.getByText(label).parentElement
  if (!el) throw new Error(`step wrapper not found for ${label}`)
  return el
}

describe('EntryFlow の描画', () => {
  it('5ステップを常に描く（日付が NULL でも消えない）', () => {
    renderFlow({ internalDeadline: null, lotteryDate: null, paymentDeadline: null })

    for (const label of ['会内締切', '大会申込', '抽選', '支払', '開催']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('数値でない「未定」は Serif ではなく sans で出す', () => {
    renderFlow({ lotteryDate: null })

    const undecided = screen.getByText('未定')
    expect(undecided.className).toContain('font-sans')
    expect(undecided.className).not.toContain('font-display')
  })

  it('実日付は Serif ＋ tabular-nums で出す', () => {
    renderFlow()

    // 会内締切 7/31（曜日なし = 申込フローの書式）。
    const dateCell = screen.getByText('7/31')
    expect(dateCell.className).toContain('font-display')
    expect(dateCell.className).toContain('tabular-nums')
  })

  it('生 ISO 表記を出さない', () => {
    const { container } = renderFlow()

    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('開催は完了していても goal の見た目（11px の墨の輪）を保つ', () => {
    // 開催日を過去にして done にしても goal スタイルが勝つ。
    renderFlow({ eventDate: '2026-01-01', todayStr: '2026-06-01' })

    const dot = stepEl('開催').querySelector('span')
    expect(dot?.className).toContain('h-[11px]')
    expect(dot?.className).toContain('var(--kg-fg-2)')
    // done の藍の塗り点にはならない。
    expect(dot?.className).not.toContain('bg-brand')
  })

  it('現在地に aria-current="step" を付ける（高々1つ）', () => {
    const { container } = renderFlow()

    const current = container.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('会内締切')
  })

  it('期限超過かつ未完了のステップだけが朱になる', () => {
    // 大会申込の締切を過ぎているが未申込 → warn。
    renderFlow({ todayStr: '2026-08-10' })

    expect(stepEl('大会申込').querySelector('span')?.className).toContain(
      'var(--kg-accent)',
    )
    // 抽選は日付があり未超過なので朱にならない。
    expect(stepEl('抽選').querySelector('span')?.className).not.toContain(
      'var(--kg-accent)',
    )
  })

  it('not_applying では現在地を出さず、大会申込の日付欄が「申込なし」になる', () => {
    const { container } = renderFlow({ entryStatus: 'not_applying' })

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0)
    expect(screen.getByText('申込なし').className).toContain('font-sans')
  })

  it('現地払いは日付欄が「現地払い」になり中立（朱にしない）', () => {
    renderFlow({ paymentType: 'onsite', paymentDeadline: '2026-01-01', todayStr: '2026-08-10' })

    expect(screen.getByText('現地払い')).toBeTruthy()
    // 期限を過ぎていても中立なので朱にならない。
    expect(stepEl('支払').querySelector('span')?.className).not.toContain(
      'var(--kg-accent)',
    )
  })
})
