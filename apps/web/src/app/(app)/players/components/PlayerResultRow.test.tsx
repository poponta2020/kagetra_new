import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PlayerSearchResult } from '@/lib/players/queries'
import { PlayerResultRow } from './PlayerResultRow'

const NOW_YEAR = 2026

function player(overrides: Partial<PlayerSearchResult> = {}): PlayerSearchResult {
  return {
    id: 1,
    displayName: '山本 陽子',
    affiliation: '東京東会',
    prefecture: null,
    participationCount: 203,
    currentGrade: 'A',
    lastEventDate: '2026-06-01',
    lastTournamentName: '第40回高松宮記念杯',
    lastResult: '優勝',
    ...overrides,
  }
}

function renderRow(overrides: Partial<PlayerSearchResult> = {}) {
  return render(<PlayerResultRow player={player(overrides)} nowYear={NOW_YEAR} />)
}

describe('PlayerResultRow', () => {
  it('氏名・現級(A)・所属会・出場大会数・chevron・詳細リンクを描画する', () => {
    renderRow({ id: 42 })
    expect(screen.getByText('山本 陽子')).toBeTruthy()
    expect(screen.getByText('(A)')).toBeTruthy()
    expect(screen.getByText('東京東会')).toBeTruthy()
    // 出場大会数は数値 span＋単位 small を跨ぐので親（リンク）の textContent 単位で検証
    // （getByText の直接テキストノード依存を避け、Testing Library 内部挙動に頼らない）。
    expect(screen.getByRole('link').textContent).toContain('203大会')
    expect(screen.getByText('›')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/players/42')
  })

  it('最終出場を YYYY/MM＋大会名＋結果で 1 行集約し、入賞は藍（brand-fg）', () => {
    renderRow({ lastEventDate: '2026-05-01', lastTournamentName: '第72回全日本かるた選手権', lastResult: '準優勝' })
    expect(screen.getByText('2026/05')).toBeTruthy()
    expect(screen.getByRole('link').textContent).toContain('第72回全日本かるた選手権')
    const res = screen.getByText('準優勝')
    expect(res.className).toContain('text-brand-fg')
    expect(res.className).not.toContain('text-ink-muted')
  })

  it('結果が無い最終出場は「記録なし」を砂ミュートで出す（藍にしない）', () => {
    renderRow({ lastResult: null })
    const res = screen.getByText('記録なし')
    expect(res.className).toContain('text-ink-muted')
    expect(res.className).not.toContain('text-brand-fg')
  })

  it('現級が無ければ (級) 表記を出さない', () => {
    renderRow({ currentGrade: null })
    expect(screen.queryByText('(A)')).toBeNull()
  })

  it('現在年から10年以上前（境界の10年前ちょうど含む）の最終出場年月はミュート（引退の気配・砂）', () => {
    renderRow({ lastEventDate: '2016-05-01' }) // 2026 - 10 = 2016（ちょうど10年前）→ ミュート
    const yr = screen.getByText('2016/05')
    expect(yr.className).toContain('text-ink-muted')
  })

  it('2017年以降（10年未満前）の最終出場年月は通常色（ミュートしない）', () => {
    renderRow({ lastEventDate: '2019-11-01' }) // 2026 - 7 年前 → 通常
    const yr = screen.getByText('2019/11')
    expect(yr.className).toContain('text-ink-meta')
    expect(yr.className).not.toContain('text-ink-muted')
  })

  it('開催日が無い最終出場は「開催日不明」をミュートで出す', () => {
    renderRow({ lastEventDate: null, lastTournamentName: '全国かるた大会（詳細不明）', lastResult: null })
    const yr = screen.getByText('開催日不明')
    expect(yr.className).toContain('text-ink-muted')
    expect(screen.getByRole('link').textContent).toContain('全国かるた大会（詳細不明）')
  })

  it('所属が無ければ「所属不明」', () => {
    renderRow({ affiliation: null })
    expect(screen.getByText('所属不明')).toBeTruthy()
  })

  it('出場記録が全く無い（大会名 null）行は「出場記録なし」を出す', () => {
    renderRow({ lastEventDate: null, lastTournamentName: null, lastResult: null, participationCount: 0 })
    expect(screen.getByText('出場記録なし')).toBeTruthy()
    expect(screen.getByRole('link').textContent).toContain('0大会')
  })

  it('長い氏名・所属・大会名は省略記号（truncate）で 1 行に収める', () => {
    renderRow({
      displayName: '超長い名前の選手だよとても長い',
      affiliation: 'とても長い名前の所属かるた会だよ',
    })
    expect(screen.getByText('超長い名前の選手だよとても長い').className).toContain('truncate')
    expect(screen.getByText('とても長い名前の所属かるた会だよ').className).toContain('truncate')
  })
})
