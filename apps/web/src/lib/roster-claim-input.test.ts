import { describe, expect, it } from 'vitest'
import { parseRosterClaimInput } from './roster-claim-input'

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(data)) fd.set(k, v)
  return fd
}

const NEEDS_NONE = { needsPhone: false, needsBirthDate: false }
const NEEDS_BOTH = { needsPhone: true, needsBirthDate: true }

describe('parseRosterClaimInput — サークル所属 OFF', () => {
  it('is all-null when the checkbox is absent', () => {
    const result = parseRosterClaimInput(formOf({ userId: 'u1' }), NEEDS_NONE)
    expect(result).toEqual({
      data: {
        isCircleMember: false,
        facultyKind: null,
        faculty: null,
        schoolYear: null,
        phone: null,
        birthDate: null,
      },
    })
  })

  it('ignores faculty/phone fields even if present', () => {
    const result = parseRosterClaimInput(
      formOf({
        userId: 'u1',
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        phone: '090-1234-5678',
        birthDate: '1990-04-01',
      }),
      NEEDS_NONE,
    )
    expect(result).toEqual({
      data: {
        isCircleMember: false,
        facultyKind: null,
        faculty: null,
        schoolYear: null,
        phone: null,
        birthDate: null,
      },
    })
  })

  it('does not require phone/birthDate even when needs are true', () => {
    const result = parseRosterClaimInput(formOf({ userId: 'u1' }), NEEDS_BOTH)
    expect('error' in result).toBe(false)
    if ('data' in result) {
      expect(result.data.phone).toBeNull()
      expect(result.data.birthDate).toBeNull()
    }
  })
})

describe('parseRosterClaimInput — サークル所属 ON', () => {
  function onForm(extra: Record<string, string> = {}): FormData {
    return formOf({
      userId: 'u1',
      isCircleMember: 'on',
      ...extra,
    })
  }

  it('requires facultyKind', () => {
    const result = parseRosterClaimInput(onForm({ faculty: '法学部', schoolYear: '1年' }), NEEDS_NONE)
    expect(result).toEqual({ error: '所属（学部／大学院）を選択してください' })
  })

  it('requires faculty', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'undergraduate', schoolYear: '1年' }),
      NEEDS_NONE,
    )
    expect(result).toEqual({ error: '学部等名を入力してください' })
  })

  it('rejects a faculty name over 50 chars', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: 'あ'.repeat(51),
        schoolYear: '1年',
      }),
      NEEDS_NONE,
    )
    expect(result).toEqual({ error: '学部等名は50文字以内で入力してください' })
  })

  it('requires schoolYear', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'undergraduate', faculty: '法学部' }),
      NEEDS_NONE,
    )
    expect(result).toEqual({ error: '学年を選択してください' })
  })

  it('rejects a schoolYear that does not match facultyKind (undergraduate + 修士1年)', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'undergraduate', faculty: '法学部', schoolYear: '修士1年' }),
      NEEDS_NONE,
    )
    expect(result).toEqual({ error: '学年を選択してください' })
  })

  it('accepts a schoolYear matching graduate', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'graduate', faculty: '情報科学院', schoolYear: '修士1年' }),
      NEEDS_NONE,
    )
    expect('error' in result).toBe(false)
  })

  it('requires phone when needsPhone is true', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'undergraduate', faculty: '法学部', schoolYear: '1年' }),
      { needsPhone: true, needsBirthDate: false },
    )
    expect(result).toEqual({ error: '電話番号は数字とハイフンで入力してください' })
  })

  it('fills phone when valid and needsPhone is true', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        phone: '090-1234-5678',
      }),
      { needsPhone: true, needsBirthDate: false },
    )
    expect('data' in result && result.data.phone).toBe('090-1234-5678')
  })

  it('ignores phone when needsPhone is false', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        phone: '090-1234-5678',
      }),
      { needsPhone: false, needsBirthDate: false },
    )
    expect('data' in result && result.data.phone).toBeNull()
  })

  it('requires birthDate when needsBirthDate is true', () => {
    const result = parseRosterClaimInput(
      onForm({ facultyKind: 'undergraduate', faculty: '法学部', schoolYear: '1年' }),
      { needsPhone: false, needsBirthDate: true },
    )
    expect(result).toEqual({ error: '生年月日を入力してください' })
  })

  it('fills birthDate when valid and needsBirthDate is true', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        birthDate: '1990-04-01',
      }),
      { needsPhone: false, needsBirthDate: true },
    )
    expect('data' in result && result.data.birthDate).toBe('1990-04-01')
  })

  it('ignores birthDate when needsBirthDate is false', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        birthDate: '1990-04-01',
      }),
      { needsPhone: false, needsBirthDate: false },
    )
    expect('data' in result && result.data.birthDate).toBeNull()
  })

  it('trims faculty/schoolYear and returns all fields when needs are both false', () => {
    const result = parseRosterClaimInput(
      onForm({
        facultyKind: 'undergraduate',
        faculty: '  法学部  ',
        schoolYear: '1年',
      }),
      NEEDS_NONE,
    )
    expect(result).toEqual({
      data: {
        isCircleMember: true,
        facultyKind: 'undergraduate',
        faculty: '法学部',
        schoolYear: '1年',
        phone: null,
        birthDate: null,
      },
    })
  })
})
