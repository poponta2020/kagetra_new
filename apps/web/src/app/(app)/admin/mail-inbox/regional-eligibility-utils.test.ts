import { describe, expect, it } from 'vitest'
import type { RegionalEligibility } from '@kagetra/mail-worker/classify/schema'
import { planRegionalEligibility } from './regional-eligibility-utils'

const D_QUOTE =
  'D級 初段の方 地域制限有 近畿支部及び隣接県（鳥取、岡山、徳島）の会所属、及び支部内在住・在勤・在学の方'
const E_QUOTE =
  'E級 初段を目指す方。 地域制限有 兵庫県内の会所属、及び兵庫県内在住・在勤・在学の方'

function re(overrides: Partial<RegionalEligibility>): RegionalEligibility {
  return {
    grade: 'D',
    verdict: '要確認',
    evidence_quote: null,
    ...overrides,
  }
}

describe('planRegionalEligibility', () => {
  it('照合済み対象外の D・E を対象級から外す（A〜E の単位）', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['A', 'B', 'C', 'D', 'E'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
        re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
      ],
    })

    expect(plan.removedGrades).toEqual(['D', 'E'])
    expect(plan.effectiveGrades).toEqual(['A', 'B', 'C'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([
      { grade: 'D', kind: 'removed', quote: D_QUOTE },
      { grade: 'E', kind: 'removed', quote: E_QUOTE },
    ])
  })

  it('未照合の対象外 (evidence_verified: false) は外さず unverified になる', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['D'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: false }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['D'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([{ grade: 'D', kind: 'unverified', quote: D_QUOTE }])
  })

  it('未照合の対象外 (evidence_verified 未指定) も外さず unverified になる', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['D'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.notices).toEqual([{ grade: 'D', kind: 'unverified', quote: D_QUOTE }])
  })

  it('要確認は quote ありなら quote をそのまま返し、外さない', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['D'],
      regional_eligibility: [re({ grade: 'D', verdict: '要確認', evidence_quote: '記載が曖昧' })],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['D'])
    expect(plan.notices).toEqual([{ grade: 'D', kind: 'review', quote: '記載が曖昧' }])
  })

  it('要確認は quote が null でも null のまま返す（フォールバック文言は Notice 側の責務）', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['E'],
      regional_eligibility: [re({ grade: 'E', verdict: '要確認', evidence_quote: null })],
    })

    expect(plan.notices).toEqual([{ grade: 'E', kind: 'review', quote: null }])
    expect(plan.effectiveGrades).toEqual(['E'])
  })

  it('北海道は対象は外さず eligible になる', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['E'],
      regional_eligibility: [
        re({ grade: 'E', verdict: '北海道は対象', evidence_quote: '北海道在住の方も対象です', evidence_verified: true }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['E'])
    expect(plan.notices).toEqual([{ grade: 'E', kind: 'eligible', quote: '北海道在住の方も対象です' }])
  })

  it('制限なしは notices に出さず外さない', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['D'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '制限なし', evidence_quote: '参加者の地域制限は設けません' }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['D'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([])
  })

  it('eligible_grades に無い級の判定は無視する（notices にも出さない）', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['A', 'B'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['A', 'B'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([])
  })

  it('D・E のみの単位で両方照合済み対象外なら effectiveGrades が空で allRemoved=true', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['D', 'E'],
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
        re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
      ],
    })

    expect(plan.removedGrades).toEqual(['D', 'E'])
    expect(plan.effectiveGrades).toEqual([])
    expect(plan.allRemoved).toBe(true)
  })

  it('regional_eligibility が欠落しているときは何もしない', () => {
    const plan = planRegionalEligibility({ eligible_grades: ['A', 'B'] })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['A', 'B'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([])
  })

  it('regional_eligibility が空配列のときは何もしない', () => {
    const plan = planRegionalEligibility({
      eligible_grades: ['A', 'B'],
      regional_eligibility: [],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toEqual(['A', 'B'])
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([])
  })

  it('eligible_grades が null のときは何もしない（effectiveGrades も null のまま）', () => {
    const plan = planRegionalEligibility({
      eligible_grades: null,
      regional_eligibility: [
        re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
      ],
    })

    expect(plan.removedGrades).toEqual([])
    expect(plan.effectiveGrades).toBeNull()
    expect(plan.allRemoved).toBe(false)
    expect(plan.notices).toEqual([])
  })
})
