import { describe, it, expect } from 'vitest'
import { users } from '../src/schema'

describe('invite-register-redesign: users profile/PII columns', () => {
  it('adds the structured-name + PII columns with the expected SQL names', () => {
    expect(users.familyName.name).toBe('family_name')
    expect(users.givenName.name).toBe('given_name')
    expect(users.familyKana.name).toBe('family_kana')
    expect(users.givenKana.name).toBe('given_kana')
    expect(users.birthDate.name).toBe('birth_date')
    expect(users.phone.name).toBe('phone')
    expect(users.postalCode.name).toBe('postal_code')
    expect(users.address1.name).toBe('address1')
    expect(users.address2.name).toBe('address2')
  })

  it('keeps every new column nullable (existing ~100 members stay NULL)', () => {
    for (const col of [
      users.familyName,
      users.givenName,
      users.familyKana,
      users.givenKana,
      users.birthDate,
      users.phone,
      users.postalCode,
      users.address1,
      users.address2,
    ]) {
      expect(col.notNull).toBe(false)
      expect(col.hasDefault).toBe(false)
    }
  })

  it('stores birth_date as a date column in string mode (YYYY-MM-DD)', () => {
    // String mode keeps the round-trip a plain 'YYYY-MM-DD' string, matching
    // the <input type="date"> value and the zod schema in registerViaInvite.
    expect(users.birthDate.columnType).toBe('PgDateString')
  })

  it('leaves the reused canonical columns intact (name UNIQUE, grade/gender/dan/zenNichikyo)', () => {
    // `name` is still the canonical display + UNIQUE key (合成表示名).
    expect(users.name.name).toBe('name')
    expect(users.name.isUnique).toBe(true)
    expect(users.grade.name).toBe('grade')
    expect(users.gender.name).toBe('gender')
    expect(users.dan.name).toBe('dan')
    // zen_nichikyo is reused (NOT NULL default false), not re-added.
    expect(users.zenNichikyo.name).toBe('zen_nichikyo')
    expect(users.zenNichikyo.notNull).toBe(true)
  })
})
