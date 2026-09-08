import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {
  EventUnit,
  ExtractionPayload,
  RegionalEligibility,
} from '@kagetra/mail-worker/classify/schema'
import {
  VERDICT_UNRESTRICTED,
  VERDICT_HOME_ELIGIBLE,
  VERDICT_HOME_INELIGIBLE,
  VERDICT_NEEDS_REVIEW,
} from '@kagetra/mail-worker/classify/regional'
import { ExtractedPayloadView } from './ExtractedPayloadView'

const HEADING = '地域制限（D・E 級）'

/**
 * Build a fully-populated EventUnit. Mirrors ApprovalForm.test.tsx's
 * buildUnit() so both fixtures stay in sync with the schema shape.
 */
function buildUnit(overrides: Partial<EventUnit> = {}): EventUnit {
  return {
    unit_key: 'u1',
    event_date: '2030-12-01',
    eligible_grades: ['D', 'E'],
    formal_name: '第10回テスト大会D・E級',
    venue: 'AI 会場',
    payment_deadline: '2030-11-25',
    payment_deadline_kind: '日付あり',
    payment_info_text: '○○銀行 普通 1234567',
    payment_method: '口座振込',
    entry_method: 'メール',
    organizer_text: '主催 X',
    entry_deadline: '2030-11-30',
    kind: 'individual',
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: 32,
    capacity_e: 32,
    official: true,
    regional_eligibility: [],
    ...overrides,
  }
}

function buildPayload(events: EventUnit[]): ExtractionPayload {
  return {
    reason: 'fixture',
    events,
  }
}

function openAllDetails(container: HTMLElement) {
  container
    .querySelectorAll('details')
    .forEach((d) => {
      d.open = true
    })
}

describe('ExtractedPayloadView — 地域制限（D・E 級） AC-76', () => {
  it('4種の判定・根拠の一文を表示し、[object Object] が出ない', () => {
    const regional: RegionalEligibility[] = [
      {
        grade: 'D',
        verdict: VERDICT_UNRESTRICTED,
        evidence_quote: null,
      },
      {
        grade: 'E',
        verdict: VERDICT_HOME_ELIGIBLE,
        evidence_quote: '北海道地区は対象に含む',
        evidence_verified: true,
      },
    ]
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', regional_eligibility: regional }),
    ])
    const { container } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(container)

    expect(screen.getByText(HEADING)).toBeTruthy()
    expect(screen.getByText(VERDICT_UNRESTRICTED)).toBeTruthy()
    expect(screen.getByText(VERDICT_HOME_ELIGIBLE)).toBeTruthy()
    expect(screen.getByText('北海道地区は対象に含む')).toBeTruthy()
    expect(container.textContent).not.toContain('[object Object]')
  })

  it('対象外・要確認の判定も表示する', () => {
    const regional: RegionalEligibility[] = [
      { grade: 'D', verdict: VERDICT_HOME_INELIGIBLE, evidence_quote: '北海道地区は対象外' },
      { grade: 'E', verdict: VERDICT_NEEDS_REVIEW, evidence_quote: null },
    ]
    const payload = buildPayload([
      buildUnit({ regional_eligibility: regional }),
    ])
    const { container } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(container)

    expect(screen.getByText(VERDICT_HOME_INELIGIBLE)).toBeTruthy()
    expect(screen.getByText(VERDICT_NEEDS_REVIEW)).toBeTruthy()
  })

  it('evidence_verified の true/false/undefined と evidence_quote の null を照合列・根拠列に反映する', () => {
    const regional: RegionalEligibility[] = [
      {
        grade: 'D',
        verdict: VERDICT_HOME_ELIGIBLE,
        evidence_quote: '北海道は対象と明記',
        evidence_verified: true,
      },
      {
        grade: 'E',
        verdict: VERDICT_HOME_INELIGIBLE,
        evidence_quote: '北海道は対象外と明記',
        evidence_verified: false,
      },
    ]
    const payload = buildPayload([
      buildUnit({
        unit_key: 'u1',
        eligible_grades: ['D'],
        regional_eligibility: [regional[0]!],
      }),
    ])
    const { container: c1 } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(c1)
    expect(screen.getByText('照合済み')).toBeTruthy()

    const payload2 = buildPayload([
      buildUnit({
        unit_key: 'u1',
        eligible_grades: ['E'],
        regional_eligibility: [regional[1]!],
      }),
    ])
    const { container: c2 } = render(
      <ExtractedPayloadView
        payload={payload2}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(c2)
    expect(screen.getByText('未照合')).toBeTruthy()

    // evidence_verified 省略 → 照合列は「—」。evidence_quote: null → 根拠列も「—」。
    const payload3 = buildPayload([
      buildUnit({
        regional_eligibility: [
          { grade: 'D', verdict: VERDICT_UNRESTRICTED, evidence_quote: null },
        ],
      }),
    ])
    const { container: c3 } = render(
      <ExtractedPayloadView
        payload={payload3}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(c3)
    const dashCells = Array.from(c3.querySelectorAll('td')).filter(
      (td) => td.textContent === '—',
    )
    // 根拠列と照合列の少なくとも2セルが「—」になっているはず。
    expect(dashCells.length).toBeGreaterThanOrEqual(2)
  })

  it('regional_eligibility が空配列の単位では見出しを出さない', () => {
    const payload = buildPayload([buildUnit({ regional_eligibility: [] })])
    const { container } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(container)
    expect(screen.queryByText(HEADING)).toBeNull()
  })

  it('regional_eligibility を持たない旧 payload では見出しを出さず、既存項目は従来どおり表示する', () => {
    const legacyUnit = {
      unit_key: 'u1',
      event_date: '2030-12-01',
      eligible_grades: ['A'],
      formal_name: '旧形式の大会',
      venue: '旧会場',
      payment_deadline: null,
      payment_deadline_kind: '未定',
      payment_info_text: null,
      payment_method: '当日会場払い',
      entry_method: 'メール',
      organizer_text: null,
      entry_deadline: '2030-11-30',
      kind: 'individual',
      capacity_total: null,
      capacity_a: null,
      capacity_b: null,
      capacity_c: null,
      capacity_d: null,
      capacity_e: null,
      official: null,
      // no regional_eligibility — 3.0.x 以前のドラフト
    }
    const payload = {
      reason: 'legacy fixture',
      events: [legacyUnit],
    } as unknown as ExtractionPayload

    const { container } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="2.5.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(container)

    expect(screen.queryByText(HEADING)).toBeNull()
    expect(screen.getByText('旧形式の大会')).toBeTruthy()
  })

  it('2単位ではそれぞれの単位の表の後に小表が付く', () => {
    const unit1 = buildUnit({
      unit_key: 'u1',
      regional_eligibility: [
        { grade: 'D', verdict: VERDICT_UNRESTRICTED, evidence_quote: null },
      ],
    })
    const unit2 = buildUnit({
      unit_key: 'u2',
      regional_eligibility: [
        {
          grade: 'E',
          verdict: VERDICT_HOME_ELIGIBLE,
          evidence_quote: '北海道は対象',
        },
      ],
    })
    const payload = buildPayload([unit1, unit2])
    const { container } = render(
      <ExtractedPayloadView
        payload={payload}
        aiModel="claude-x"
        promptVersion="3.1.0"
        aiCostUsd={null}
      />,
    )
    openAllDetails(container)

    expect(screen.getByText('イベント 1')).toBeTruthy()
    expect(screen.getByText('イベント 2')).toBeTruthy()
    const headings = screen.getAllByText(HEADING)
    expect(headings.length).toBe(2)
  })
})
