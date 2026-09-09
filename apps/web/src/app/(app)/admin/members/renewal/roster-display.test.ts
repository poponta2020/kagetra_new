import { describe, expect, it } from 'vitest'
import type { RenewalSnapshot } from '@kagetra/shared'
import type { RosterDiffEntry } from '@/lib/membership-renewal/diff'
import {
  buildDisplayDiffRows,
  changedGroupLabels,
  combinedKanaValue,
  combinedNameValue,
  unchangedGroupSummary,
} from './roster-display'

/**
 * annual-registration-renewal タスク9: S2 の表示グループ化ロジック（氏名/ふりがな
 * の結合・住所グループの状態語・「変更のない項目」の要約）の単体テスト。
 * DB を触らない純ロジックなので Wave 中でも安全に実行できる。
 */

function snapshot(overrides: Partial<RenewalSnapshot> = {}): RenewalSnapshot {
  return {
    v: 1,
    familyName: '北海',
    givenName: '太郎',
    familyKana: 'ほっかい',
    givenKana: 'たろう',
    birthDate: '2004-06-12',
    gender: 'male',
    dan: 4,
    grade: 'A',
    postalCode: '0010017',
    address1: '札幌市北区北17条西3-1-38',
    address2: null,
    phone: '090-0000-0000',
    facultyKind: null,
    faculty: null,
    schoolYear: null,
    ...overrides,
  }
}

describe('changedGroupLabels', () => {
  it('郵便番号・住所1・住所2 の変更をまとめて「住所」1件にする', () => {
    const diff: RosterDiffEntry[] = [
      { field: 'postalCode', label: '郵便番号', before: '001-0013', after: '183-0013' },
      { field: 'address1', label: '住所1', before: 'A', after: 'B' },
      { field: 'address2', label: '住所2', before: 'C', after: 'D' },
    ]
    expect(changedGroupLabels(diff)).toEqual(['住所'])
  })

  it('氏名・ふりがな・住所・電話番号など複数グループを順序どおり返す', () => {
    const diff: RosterDiffEntry[] = [
      { field: 'familyName', label: '姓', before: '室蘭', after: '登別' },
      { field: 'familyKana', label: 'せい', before: 'むろらん', after: 'のぼりべつ' },
      { field: 'phone', label: '電話番号', before: 'X', after: 'Y' },
    ]
    expect(changedGroupLabels(diff)).toEqual(['氏名', 'ふりがな', '電話番号'])
  })

  it('差分が無ければ空配列', () => {
    expect(changedGroupLabels([])).toEqual([])
  })
})

describe('unchangedGroupSummary', () => {
  it('変更グループが1つだけなら残り7グループ中4件+「ほか」で要約する', () => {
    const diff: RosterDiffEntry[] = [
      { field: 'postalCode', label: '郵便番号', before: 'A', after: 'B' },
      { field: 'address1', label: '住所1', before: 'A', after: 'B' },
      { field: 'address2', label: '住所2', before: 'A', after: 'B' },
    ]
    const summary = unchangedGroupSummary(diff)
    expect(summary.endsWith(' ほか')).toBe(true)
    expect(summary).not.toContain('住所')
  })

  it('全グループ変更なしなら8件のうち先頭4件+「ほか」', () => {
    const summary = unchangedGroupSummary([])
    expect(summary).toBe('氏名・ふりがな・生年月日・性別 ほか')
  })

  it('変更グループが多く残りが4件以下ならそのまま連結する（「ほか」を付けない）', () => {
    // 8グループ中5グループを変更 → 残り3グループ（4件以下）。
    const diff: RosterDiffEntry[] = [
      { field: 'familyName', label: '姓', before: 'A', after: 'B' },
      { field: 'familyKana', label: 'せい', before: 'A', after: 'B' },
      { field: 'birthDate', label: '生年月日', before: 'A', after: 'B' },
      { field: 'gender', label: '性別', before: 'A', after: 'B' },
      { field: 'dan', label: '段位', before: '1', after: '2' },
    ]
    expect(unchangedGroupSummary(diff)).toBe('級・住所・電話番号')
  })
})

describe('combinedNameValue / combinedKanaValue', () => {
  it('姓名・ふりがなをスペース区切りで結合する', () => {
    const s = snapshot()
    expect(combinedNameValue(s)).toBe('北海 太郎')
    expect(combinedKanaValue(s)).toBe('ほっかい たろう')
  })

  it('両方 null なら null', () => {
    const s = snapshot({ familyName: null, givenName: null })
    expect(combinedNameValue(s)).toBe(null)
  })
})

describe('buildDisplayDiffRows', () => {
  it('氏名・ふりがなの変更を1行に結合し、住所は個別行のまま前→後で並べる（design-mock 準拠）', () => {
    const before = snapshot()
    const after = snapshot({
      familyName: '登別',
      familyKana: 'のぼりべつ',
      postalCode: '183-0013',
    })
    const diff: RosterDiffEntry[] = [
      { field: 'familyName', label: '姓', before: '北海', after: '登別' },
      { field: 'familyKana', label: 'せい', before: 'ほっかい', after: 'のぼりべつ' },
      { field: 'postalCode', label: '郵便番号', before: '0010017', after: '183-0013' },
    ]

    const rows = buildDisplayDiffRows(diff, before, after)

    expect(rows).toEqual([
      { label: '氏名', before: '北海 太郎', after: '登別 太郎' },
      { label: 'ふりがな', before: 'ほっかい たろう', after: 'のぼりべつ たろう' },
      { label: '郵便番号', before: '0010017', after: '183-0013' },
    ])
  })

  it('差分が空なら空配列', () => {
    const s = snapshot()
    expect(buildDisplayDiffRows([], s, s)).toEqual([])
  })
})
