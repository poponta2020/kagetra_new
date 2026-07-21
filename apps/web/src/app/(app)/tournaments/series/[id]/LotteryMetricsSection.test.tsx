import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  AGradeCutoffAggregate,
  LotteryMetricGrade,
  SeriesGradeLotteryMetric,
  SeriesLotteryMetrics,
} from '@/lib/lottery/series-metrics'
import { LotteryMetricsSection } from './LotteryMetricsSection'

function metric(
  grade: LotteryMetricGrade,
  overrides: Partial<SeriesGradeLotteryMetric> = {},
): SeriesGradeLotteryMetric {
  return {
    editionId: 1,
    editionNumber: 10,
    year: 2030,
    grade,
    selectionStatus: 'lottery',
    completeness: 'complete',
    missingReasons: [],
    applicantCount: 150,
    acceptedCount: 100,
    waitlistedCount: 30,
    rejectedCount: 20,
    unresolvedCount: 0,
    capacity: 100,
    lotteryRatio: { numerator: 150, denominator: 100, formatted: '1.50' },
    remainingSlots: null,
    occupancy: null,
    aGradeCutoff: null,
    ...overrides,
  }
}

const completeCutoff: AGradeCutoffAggregate = {
  completeness: 'complete',
  missingReasons: [],
  associationYear: 2029,
  referenceDate: '2030-02-28',
  ruleVersion: 'ajka-a-priority-2024-v1',
  organizerSlots: {
    applicantCount: 10,
    acceptedCount: 10,
    waitlistedCount: 0,
    rejectedCount: 0,
  },
  appearanceBuckets: [
    { appearanceCount: 0, applicantCount: 30, acceptedCount: 30, waitlistedCount: 0, rejectedCount: 0 },
    { appearanceCount: 1, applicantCount: 30, acceptedCount: 30, waitlistedCount: 0, rejectedCount: 0 },
    { appearanceCount: 2, applicantCount: 50, acceptedCount: 20, waitlistedCount: 25, rejectedCount: 5 },
  ],
  capacityLine: {
    capacity: 100,
    boundaryAppearanceCount: 2,
    applicantsBeforeBoundary: 70,
    applicantsInBoundary: 50,
    acceptedInBoundary: 20,
    waitlistedInBoundary: 25,
    rejectedInBoundary: 5,
    remainingSlots: 0,
  },
}

function renderMetrics(points: SeriesGradeLotteryMetric[]) {
  const metrics: SeriesLotteryMetrics = { points }
  return render(<LotteryMetricsSection metrics={metrics} seriesName="北海個人情報大会" />)
}

describe('LotteryMetricsSection', () => {
  it('A〜E級を切り替え、倍率を小数第2位と分子・分母で表示する', () => {
    renderMetrics([
      metric('A', { aGradeCutoff: completeCutoff }),
      metric('B', {
        editionId: 2,
        applicantCount: 132,
        acceptedCount: 120,
        lotteryRatio: { numerator: 132, denominator: 120, formatted: '1.10' },
      }),
    ])

    expect(screen.getAllByText('1.50倍').length).toBeGreaterThan(0)
    expect(screen.getByText('申込者 150人')).toBeTruthy()
    expect(screen.getByText('抽選時確定者 100人')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'B級' }))
    expect(screen.getAllByText('1.10倍').length).toBeGreaterThan(0)
    expect(screen.getByText('申込者 132人')).toBeTruthy()
    expect(screen.queryByText('A級の年度内出場回数別内訳')).toBeNull()
  })

  it('定員未満は残り枠と充足率、定員なしは専用文言だけを表示する', () => {
    renderMetrics([
      metric('A', {
        selectionStatus: 'under_capacity',
        applicantCount: 80,
        acceptedCount: null,
        waitlistedCount: null,
        rejectedCount: null,
        unresolvedCount: null,
        lotteryRatio: null,
        capacity: 100,
        remainingSlots: 20,
        occupancy: { numerator: 80, denominator: 100, percentage: 80, formatted: '80%' },
      }),
      metric('B', {
        editionId: 2,
        selectionStatus: 'no_capacity',
        applicantCount: 72,
        acceptedCount: null,
        waitlistedCount: null,
        rejectedCount: null,
        unresolvedCount: null,
        lotteryRatio: null,
        capacity: null,
      }),
    ])

    expect(screen.getByText('定員 100人')).toBeTruthy()
    expect(screen.getByText('残り 20枠')).toBeTruthy()
    expect(screen.getByText('定員充足率 80%')).toBeTruthy()
    expect(screen.getByText('抽選なし')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'B級' }))
    expect(screen.getByText('定員なし・抽選なし')).toBeTruthy()
    expect(screen.getByText('申込者 72人')).toBeTruthy()
    expect(screen.queryByText(/残り/)).toBeNull()
    expect(screen.queryByText(/充足率/)).toBeNull()
  })

  it('incompleteは理由だけを表示し、取得済みらしい数値を公開しない', () => {
    renderMetrics([
      metric('A', {
        completeness: 'incomplete',
        missingReasons: ['missing_selection_result_roster'],
        applicantCount: 150,
        acceptedCount: null,
        lotteryRatio: null,
      }),
    ])

    expect(screen.getAllByText('データ不足').length).toBeGreaterThan(0)
    expect(screen.getByText('抽選結果発表時の確定名簿がありません')).toBeTruthy()
    expect(screen.queryByText('申込者 150人')).toBeNull()
    expect(screen.queryByText('0人')).toBeNull()
  })

  it('A級は主催者枠と0/1/2回層、定員線、完全な境界説明を表示する', () => {
    const { container } = renderMetrics([metric('A', { aGradeCutoff: completeCutoff })])

    expect(screen.getByRole('img', { name: /A級の年度内出場回数別申込者/ })).toBeTruthy()
    expect(container.querySelectorAll('[data-a-grade-segment]')).toHaveLength(4)
    expect(container.querySelector('[data-testid="a-grade-capacity-line"]')).toBeTruthy()
    expect(screen.getByText('主催者枠 10人')).toBeTruthy()
    expect(screen.getByText('0回 30人')).toBeTruthy()
    expect(screen.getByText('1回 30人')).toBeTruthy()
    expect(screen.getByText('2回 50人')).toBeTruthy()
    expect(screen.getByText(/当落線は2回層/)).toBeTruthy()
    expect(screen.getByText(/当選20人/)).toBeTruthy()
    expect(screen.getByText(/落選・キャンセル待ち30人/)).toBeTruthy()
  })

  it('A級当落線が不完全な場合は推定境界を表示しない', () => {
    renderMetrics([
      metric('A', {
        aGradeCutoff: {
          ...completeCutoff,
          completeness: 'incomplete',
          missingReasons: ['incomplete_appearance_history'],
          capacityLine: { ...completeCutoff.capacityLine!, boundaryAppearanceCount: null },
        },
      }),
    ])

    expect(screen.getByText('当落線はデータ不足のため表示できません')).toBeTruthy()
    expect(screen.getByText('基準日時点の出場履歴が不足しています')).toBeTruthy()
    expect(screen.queryByText(/当落線は2回層/)).toBeNull()
  })

  it('空状態と級ごとのデータなしを0人にせず区別する', () => {
    const { rerender } = render(
      <LotteryMetricsSection metrics={{ points: [] }} seriesName="空大会" />,
    )
    expect(screen.getByText('級別の申込・抽選データはまだありません')).toBeTruthy()
    expect(screen.queryByText('0人')).toBeNull()

    rerender(<LotteryMetricsSection metrics={{ points: [metric('A')] }} seriesName="空大会" />)
    fireEvent.click(screen.getByRole('tab', { name: 'E級' }))
    expect(screen.getByText('E級のデータはありません')).toBeTruthy()
  })

  it('一般表示へ個人名や内部IDを描画しない', () => {
    const { container } = renderMetrics([metric('A', { editionId: 987654, aGradeCutoff: completeCutoff })])
    expect(container.textContent).not.toContain('北海個人情報大会')
    expect(container.textContent).not.toContain('987654')
    expect(container.innerHTML).not.toMatch(/playerId|userId|mailMessage|rosterId/)

    const breakdown = screen.getByRole('list', { name: 'A級の開催回別内訳' })
    expect(within(breakdown).getByText('第10回')).toBeTruthy()
  })

  it('長い系列では横軸の回次ラベルを間引く', () => {
    renderMetrics(
      Array.from({ length: 12 }, (_, index) =>
        metric('A', {
          editionId: index + 1,
          editionNumber: index + 1,
          year: 2019 + index,
        }),
      ),
    )

    const chart = screen.getByRole('img', { name: 'A級の申込者数と抽選・定員の推移' })
    expect(chart.querySelectorAll('text')).toHaveLength(7)
    expect(chart.textContent).toContain('第1回')
    expect(chart.textContent).toContain('第12回')
  })
})
