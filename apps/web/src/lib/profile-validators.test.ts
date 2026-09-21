import { describe, expect, it } from 'vitest'
import { validateBirthDate, validatePhone } from './profile-validators'

describe('validateBirthDate', () => {
  it('accepts a valid date', () => {
    expect(validateBirthDate('1990-04-01')).toBeNull()
  })

  it('accepts the year-1900 boundary', () => {
    expect(validateBirthDate('1900-01-01')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(validateBirthDate('')).toBe('生年月日を入力してください')
  })

  it('rejects a non YYYY-MM-DD format', () => {
    expect(validateBirthDate('1990/04/01')).toBe('生年月日を入力してください')
  })

  it('rejects a calendar-invalid date', () => {
    expect(validateBirthDate('2023-02-30')).toBe('生年月日が正しくありません')
  })

  it('rejects a year before 1900', () => {
    expect(validateBirthDate('1899-12-31')).toBe('生年月日が正しくありません')
  })

  it('rejects a future date', () => {
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const s = tomorrow.toISOString().slice(0, 10)
    expect(validateBirthDate(s)).toBe('生年月日に未来の日付は指定できません')
  })
})

describe('validatePhone', () => {
  it('accepts a hyphenated phone number', () => {
    expect(validatePhone('090-1234-5678')).toBeNull()
  })

  it('accepts a 10-digit phone number', () => {
    expect(validatePhone('0112345678')).toBeNull()
  })

  it('accepts a 13-digit phone number', () => {
    expect(validatePhone('0901234567890')).toBeNull()
  })

  it('rejects a 14-digit phone number', () => {
    expect(validatePhone('09012345678901')).toBe(
      '電話番号の桁数が不正です（10〜13桁）',
    )
  })

  it('rejects fewer than 10 digits', () => {
    expect(validatePhone('090-123')).toBe('電話番号の桁数が不正です（10〜13桁）')
  })

  it('rejects an empty string', () => {
    expect(validatePhone('')).toBe('電話番号は数字とハイフンで入力してください')
  })

  it('rejects full-width digits', () => {
    expect(validatePhone('０９０１２３４５６７８')).toBe(
      '電話番号は数字とハイフンで入力してください',
    )
  })

  it('rejects whitespace-separated digits', () => {
    expect(validatePhone('090 1234 5678')).toBe(
      '電話番号は数字とハイフンで入力してください',
    )
  })
})
