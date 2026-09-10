import { describe, expect, it } from 'vitest'
import { deriveRenewalAlert, type RenewalAlertSource } from './alerts'

/**
 * S4 バナー判定の純関数テスト（annual-registration-renewal requirements AC-20）。
 * DB には触れない（`RenewalAlertSource` を直接組み立てる）。
 */

const TODAY = '2027-03-12'

function source(overrides: Partial<RenewalAlertSource> = {}): RenewalAlertSource {
  return {
    renewalStatus: 'open',
    deadline: '2027-03-25',
    isZennichikyoTarget: true,
    isCircleTarget: true,
    answer: null,
    schoolYearAnsweredAt: null,
    ...overrides,
  }
}

describe('deriveRenewalAlert', () => {
  it('両セクション未回答なら結合ラベルで出る', () => {
    const alert = deriveRenewalAlert(source(), TODAY)
    expect(alert).toEqual({ label: '全日協の登録と学年', daysLeft: 13 })
  })

  it('全日協だけ未回答なら「全日協の登録」', () => {
    const alert = deriveRenewalAlert(
      source({ answer: null, schoolYearAnsweredAt: new Date('2027-03-10T00:00:00Z') }),
      TODAY,
    )
    expect(alert?.label).toBe('全日協の登録')
  })

  it('学年だけ未回答なら「4月からの学年」', () => {
    const alert = deriveRenewalAlert(source({ answer: 'register' }), TODAY)
    expect(alert?.label).toBe('4月からの学年')
  })

  it('両方回答済みなら出ない', () => {
    const alert = deriveRenewalAlert(
      source({ answer: 'register', schoolYearAnsweredAt: new Date('2027-03-10T00:00:00Z') }),
      TODAY,
    )
    expect(alert).toBeNull()
  })

  it('学年セクションが対象外の会員は全日協の回答だけで消える', () => {
    const alert = deriveRenewalAlert(
      source({ isCircleTarget: false, answer: 'not_register' }),
      TODAY,
    )
    expect(alert).toBeNull()
  })

  it('全日協セクションが対象外の会員は学年の回答だけで消える', () => {
    const alert = deriveRenewalAlert(
      source({
        isZennichikyoTarget: false,
        schoolYearAnsweredAt: new Date('2027-03-10T00:00:00Z'),
      }),
      TODAY,
    )
    expect(alert).toBeNull()
  })

  it('登録完了（completed）は未回答者がいても出ない', () => {
    const alert = deriveRenewalAlert(source({ renewalStatus: 'completed' }), TODAY)
    expect(alert).toBeNull()
  })

  it('締切を過ぎても登録完了までは出し続ける（daysLeft が負値でも消えない）', () => {
    const alert = deriveRenewalAlert(source({ deadline: '2027-03-01' }), TODAY)
    expect(alert).toEqual({ label: '全日協の登録と学年', daysLeft: -11 })
  })
})
