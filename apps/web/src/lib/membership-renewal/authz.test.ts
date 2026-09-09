import { describe, it, expect } from 'vitest'
import { isRenewalAdmin } from './authz'

describe('isRenewalAdmin（R12: admin/vice_admin のみ許可）', () => {
  it('admin / vice_admin は true', () => {
    expect(isRenewalAdmin('admin')).toBe(true)
    expect(isRenewalAdmin('vice_admin')).toBe(true)
  })

  it('member / guest / 不正値 / null / undefined は false', () => {
    expect(isRenewalAdmin('member')).toBe(false)
    expect(isRenewalAdmin('guest')).toBe(false)
    expect(isRenewalAdmin('not-a-role')).toBe(false)
    expect(isRenewalAdmin(null)).toBe(false)
    expect(isRenewalAdmin(undefined)).toBe(false)
  })
})
