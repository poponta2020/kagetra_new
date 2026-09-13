import { describe, it, expect } from 'vitest'
import { RENEWAL_SNAPSHOT_VERSION, type RenewalSnapshot } from '@kagetra/shared'
import {
  buildRenewalSnapshot,
  findMissingRegisterFields,
  parseRenewalSnapshot,
  renewalSnapshotSchema,
  safeParseRenewalSnapshot,
  type RenewalSnapshotSource,
} from './snapshot'

const fullSource: RenewalSnapshotSource = {
  familyName: '土居',
  givenName: '悠太',
  familyKana: 'どい',
  givenKana: 'ゆうた',
  birthDate: '2005-04-01',
  gender: 'male',
  dan: 3,
  grade: 'A',
  postalCode: '060-0808',
  address1: '札幌市北区北8条西5丁目',
  address2: null,
  phone: '090-0000-0000',
  facultyKind: 'undergraduate',
  faculty: '工学部',
  schoolYear: '3年',
}

const fullSnapshot: RenewalSnapshot = { v: RENEWAL_SNAPSHOT_VERSION, ...fullSource }

describe('buildRenewalSnapshot（全キー明示）', () => {
  it('users の現在値からスナップショットを組み立てる', () => {
    expect(buildRenewalSnapshot(fullSource)).toEqual(fullSnapshot)
  })

  it('全項目 null の入力でも全キーが揃う（キー欠落を作らない）', () => {
    const empty: RenewalSnapshotSource = {
      familyName: null,
      givenName: null,
      familyKana: null,
      givenKana: null,
      birthDate: null,
      gender: null,
      dan: null,
      grade: null,
      postalCode: null,
      address1: null,
      address2: null,
      phone: null,
      facultyKind: null,
      faculty: null,
      schoolYear: null,
    }
    const result = buildRenewalSnapshot(empty)
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(fullSnapshot).sort(),
    )
    expect(result.v).toBe(RENEWAL_SNAPSHOT_VERSION)
  })
})

describe('renewalSnapshotSchema（zod による読み出し検証）', () => {
  it('正しい形のスナップショットを受け入れる', () => {
    expect(parseRenewalSnapshot(fullSnapshot)).toEqual(fullSnapshot)
  })

  it('v が RENEWAL_SNAPSHOT_VERSION と異なれば拒否する', () => {
    const bad = { ...fullSnapshot, v: 2 }
    expect(() => parseRenewalSnapshot(bad)).toThrow()
    expect(safeParseRenewalSnapshot(bad)).toBeNull()
  })

  it('必須項目の型が違えば拒否する（例: gender に不正な値）', () => {
    const bad = { ...fullSnapshot, gender: 'other' }
    expect(safeParseRenewalSnapshot(bad)).toBeNull()
  })

  it('キーが欠落していれば拒否する', () => {
    const { phone: _phone, ...bad } = fullSnapshot
    expect(safeParseRenewalSnapshot(bad)).toBeNull()
  })

  it('未知のキーは結果に残らない（strip される）', () => {
    const withExtra = { ...fullSnapshot, unknownField: 'leak' }
    const result = renewalSnapshotSchema.parse(withExtra)
    expect(result).not.toHaveProperty('unknownField')
    expect(Object.keys(result).sort()).toEqual(Object.keys(fullSnapshot).sort())
  })

  it('null 以外の不正な入力（配列・文字列）は拒否する', () => {
    expect(safeParseRenewalSnapshot(null)).toBeNull()
    expect(safeParseRenewalSnapshot('not an object')).toBeNull()
    expect(safeParseRenewalSnapshot([])).toBeNull()
  })
})

describe('findMissingRegisterFields（AC-5）', () => {
  const base = {
    familyName: '北海',
    givenName: '太郎',
    familyKana: 'ほっかい',
    givenKana: 'たろう',
    birthDate: '2004-06-12',
    gender: 'male' as const,
    dan: null,
    grade: 'B' as const,
    postalCode: '0010017',
    address1: '札幌市北区',
    address2: null,
    phone: '090-0000-0000',
    facultyKind: null,
    faculty: null,
    schoolYear: null,
  }

  it('全て埋まっていれば空（住所2・段位は B 級では必須ではない）', () => {
    expect(findMissingRegisterFields(base)).toEqual([])
  })

  it('欠けた項目のラベルを返す', () => {
    expect(findMissingRegisterFields({ ...base, phone: null, address1: null })).toEqual([
      '住所1',
      '電話番号',
    ])
  })

  it('段位は A 級のときだけ必須', () => {
    expect(findMissingRegisterFields({ ...base, grade: 'A', dan: null })).toEqual(['段位'])
    expect(findMissingRegisterFields({ ...base, grade: 'A', dan: 4 })).toEqual([])
  })
})
