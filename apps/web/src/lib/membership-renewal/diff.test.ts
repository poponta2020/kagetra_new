import { describe, it, expect } from 'vitest'
import { RENEWAL_SNAPSHOT_VERSION, type RenewalSnapshot } from '@kagetra/shared'
import { diffRoster, formatRosterValue } from './diff'
import type { RenewalSnapshotSource } from './snapshot'

const baseSnapshot: RenewalSnapshot = {
  v: RENEWAL_SNAPSHOT_VERSION,
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
  phone: '0900000000',
  facultyKind: 'undergraduate',
  faculty: '工学部',
  schoolYear: '3年',
}

const baseCurrent: RenewalSnapshotSource = { ...baseSnapshot }

describe('formatRosterValue（名簿の列の表示整形）', () => {
  it('段位は漢数字、性別は 男/女、級は `A級` になる', () => {
    expect(formatRosterValue('dan', baseSnapshot)).toBe('参段')
    expect(formatRosterValue('gender', baseSnapshot)).toBe('男')
    expect(formatRosterValue('grade', baseSnapshot)).toBe('A級')
  })

  it('生年月日・氏名・住所などは保存値のまま', () => {
    expect(formatRosterValue('birthDate', baseSnapshot)).toBe('2005-04-01')
    expect(formatRosterValue('familyName', baseSnapshot)).toBe('土居')
    expect(formatRosterValue('postalCode', baseSnapshot)).toBe('060-0808')
  })

  it('値が null なら null', () => {
    expect(formatRosterValue('address2', baseSnapshot)).toBeNull()
  })

  it('無段（0/null）は null（formatDanKanji に委譲）', () => {
    expect(formatRosterValue('dan', { ...baseSnapshot, dan: 0 })).toBeNull()
    expect(formatRosterValue('dan', { ...baseSnapshot, dan: null })).toBeNull()
  })
})

describe('diffRoster（AC-7）', () => {
  it('差分が無ければ空配列（継続・変更なし）', () => {
    expect(diffRoster(baseSnapshot, baseCurrent)).toEqual([])
  })

  it('氏名の変更が前→後で出る', () => {
    const current = { ...baseCurrent, familyName: '新姓' }
    const diffs = diffRoster(baseSnapshot, current)
    expect(diffs).toContainEqual({
      field: 'familyName',
      label: '姓',
      before: '土居',
      after: '新姓',
    })
  })

  it('郵便番号はハイフン・全角を除いた 7 桁へ正規化してから比較する（表示は保存値のまま）', () => {
    // 全角数字・ハイフン無しの入力だが、正規化すると同じ 7 桁になるので差分に出ない。
    const current = { ...baseCurrent, postalCode: '０６００８０８' }
    expect(diffRoster(baseSnapshot, current)).toEqual([])
  })

  it('郵便番号が実際に変わっていれば表示は保存値のまま前→後で出る', () => {
    const current = { ...baseCurrent, postalCode: '001-0011' }
    const diffs = diffRoster(baseSnapshot, current)
    expect(diffs).toContainEqual({
      field: 'postalCode',
      label: '郵便番号',
      before: '060-0808',
      after: '001-0011',
    })
  })

  it('空文字と null は同一視する（差分に出ない）', () => {
    const snapshotWithEmpty: RenewalSnapshot = { ...baseSnapshot, address2: '' as unknown as null }
    const current = { ...baseCurrent, address2: null }
    expect(diffRoster(snapshotWithEmpty, current)).toEqual([])
  })

  it('学年セクションの 3 項目（facultyKind/faculty/schoolYear）は差分の対象外', () => {
    const current = { ...baseCurrent, facultyKind: 'graduate' as const, faculty: '情報科学院', schoolYear: '修士1年' }
    expect(diffRoster(baseSnapshot, current)).toEqual([])
  })

  it('複数項目の差分が ROSTER_FIELDS の順で返る', () => {
    const current = { ...baseCurrent, givenName: '新名', phone: '0800000000' }
    const diffs = diffRoster(baseSnapshot, current)
    expect(diffs.map((d) => d.field)).toEqual(['givenName', 'phone'])
  })
})
