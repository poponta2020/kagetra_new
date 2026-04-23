import { describe, it, expect } from 'vitest'
import { roleLabel } from './role-label'

describe('roleLabel', () => {
  it("returns '管理者' + brand tone for 'admin'", () => {
    expect(roleLabel('admin')).toEqual({ label: '管理者', tone: 'brand' })
  })

  it("returns '副管理者' + brand tone for 'vice_admin'", () => {
    expect(roleLabel('vice_admin')).toEqual({
      label: '副管理者',
      tone: 'brand',
    })
  })

  it("returns '会員' + neutral tone for 'member'", () => {
    expect(roleLabel('member')).toEqual({ label: '会員', tone: 'neutral' })
  })

  it("returns '会員' + neutral tone for undefined", () => {
    expect(roleLabel(undefined)).toEqual({
      label: '会員',
      tone: 'neutral',
    })
  })

  it("returns '会員' + neutral tone for null", () => {
    expect(roleLabel(null)).toEqual({ label: '会員', tone: 'neutral' })
  })

  it("returns '会員' + neutral tone for an unknown role string", () => {
    expect(roleLabel('unknown_role')).toEqual({
      label: '会員',
      tone: 'neutral',
    })
  })
})
