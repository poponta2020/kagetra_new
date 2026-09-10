import { describe, it, expect } from 'vitest'
import { MEMBERSHIP_KIND_LABELS, resolveMembershipKind } from './membership-kind'

describe('resolveMembershipKind（会員区分の導出・定款第6条・AC-4）', () => {
  it('3/31 に 20 歳になる人は正会員（境界）', () => {
    expect(resolveMembershipKind('2006-03-31', 2026)).toBe('regular')
  })

  it('4/1 に 20 歳になる人は准会員（境界）', () => {
    expect(resolveMembershipKind('2006-04-01', 2026)).toBe('associate')
  })

  it('3/31 時点で 20 歳に届かない（19 歳）人は准会員', () => {
    expect(resolveMembershipKind('2007-03-31', 2026)).toBe('associate')
  })

  it('3/31 より前に 20 歳になっている人は正会員', () => {
    expect(resolveMembershipKind('2005-01-01', 2026)).toBe('regular')
  })

  it('生年月日が NULL なら未判定', () => {
    expect(resolveMembershipKind(null, 2026)).toBe('unknown')
  })

  it('形式不正・実在しない暦日は未判定', () => {
    expect(resolveMembershipKind('not-a-date', 2026)).toBe('unknown')
    expect(resolveMembershipKind('2026-02-30', 2026)).toBe('unknown')
    expect(resolveMembershipKind('2025-02-29', 2026)).toBe('unknown') // うるう年でない年の 2/29
  })

  it('ラベルが日本語で揃っている', () => {
    expect(MEMBERSHIP_KIND_LABELS).toEqual({
      regular: '正会員',
      associate: '准会員',
      unknown: '未判定',
    })
  })
})
