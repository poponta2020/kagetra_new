import { describe, expect, it } from 'vitest'
import {
  formatGradeLabel,
  groupGradeSet,
  isGradeApplied,
  isGroupApplied,
  listGradeCandidates,
  listUnifiedCandidates,
  normalizeGrades,
  type RosterAdoptExistingFile,
  type RosterAdoptGroup,
  type RosterAdoptGroupDay,
} from './roster-adopt-utils'

function day(
  overrides: Partial<RosterAdoptGroupDay> = {},
): RosterAdoptGroupDay {
  return {
    eventDate: '2026-08-01',
    entryStatus: 'applied',
    eligibleGrades: ['A', 'B'],
    ...overrides,
  }
}

function group(overrides: Partial<RosterAdoptGroup> = {}): RosterAdoptGroup {
  return {
    groupId: 1,
    displayName: '札幌AB',
    days: [day()],
    files: [],
    ...overrides,
  }
}

function file(overrides: Partial<RosterAdoptExistingFile> = {}): RosterAdoptExistingFile {
  return {
    rosterType: 'applicant',
    grades: null,
    ...overrides,
  }
}

describe('normalizeGrades / formatGradeLabel / groupGradeSet', () => {
  it('dedupe + A→E 昇順に正規化する', () => {
    expect(normalizeGrades(['B', 'A', 'B'])).toEqual(['A', 'B'])
  })

  it('級ラベルを整形する（正規化してから連結）', () => {
    expect(formatGradeLabel(['D'])).toBe('D級')
    expect(formatGradeLabel(['B', 'A'])).toBe('A・B級')
    expect(formatGradeLabel([])).toBe('')
  })

  it('日別 eligibleGrades の和集合を A→E 昇順で返し、全日 null なら空配列', () => {
    const g = group({
      days: [
        day({ eligibleGrades: ['C'] }),
        day({ eligibleGrades: ['A', 'B'] }),
      ],
    })
    expect(groupGradeSet(g)).toEqual(['A', 'B', 'C'])

    const noGradeGroup = group({
      days: [day({ eligibleGrades: null }), day({ eligibleGrades: null })],
    })
    expect(groupGradeSet(noGradeGroup)).toEqual([])
  })
})

describe('isGroupApplied / isGradeApplied', () => {
  it('いずれかの日が applied なら申込済み', () => {
    const g = group({
      days: [day({ entryStatus: 'not_applied' }), day({ entryStatus: 'applied' })],
    })
    expect(isGroupApplied(g)).toBe(true)
  })

  it('その級を含む日が applied でなければ appliedGrade は false', () => {
    const g = group({
      days: [
        day({ entryStatus: 'applied', eligibleGrades: ['A'] }),
        day({ entryStatus: 'not_applied', eligibleGrades: ['D'] }),
      ],
    })
    expect(isGradeApplied(g, 'A')).toBe(true)
    expect(isGradeApplied(g, 'D')).toBe(false)
  })
})

describe('listUnifiedCandidates（applicant）— AC-14', () => {
  it('申込済みで applicant 採用が無いグループは出る', () => {
    const g = group({ days: [day({ entryStatus: 'applied' })] })
    const result = listUnifiedCandidates([g], 'applicant', false)
    expect(result).toEqual([{ groupId: 1, displayName: '札幌AB' }])
  })

  it('どの日も not_applied / not_applying のグループは出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'not_applied' }), day({ entryStatus: 'not_applying' })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([])
  })

  it('applicant の統一ファイルが既にあるグループは出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'applied' })],
      files: [file({ rosterType: 'applicant', grades: null })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([])
  })

  it('applicant の級別ファイルが全級をカバーしているグループは出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: ['A', 'B'] })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([])
  })

  it('applicant の級別ファイルが一部の級だけのグループは出る', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: ['A'] })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])
  })

  it('級情報が無いグループは申込済み ∧ 統一未採用なら出る', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: null })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])
  })

  it('confirmed のファイルしか無いグループも applicant 候補として出る（種別が独立）', () => {
    const g = group({
      days: [day({ entryStatus: 'applied' })],
      files: [file({ rosterType: 'confirmed', grades: null })],
    })
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])
  })
})

describe('listGradeCandidates（applicant）— AC-15 / AC-19', () => {
  it('申込済みでその級が未採用なら出る。級は G(g) の要素だけが列挙される', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'C'] })],
    })
    const result = listGradeCandidates([g], 'applicant', false)
    expect(result.map((r) => r.grade)).toEqual(['A', 'C'])
  })

  it('その級の applicant 級別ファイルが既にあると、その級だけ出ず他の級は出る', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: ['A'] })],
    })
    const result = listGradeCandidates([g], 'applicant', false)
    expect(result.map((r) => r.grade)).toEqual(['B'])
  })

  it('applicant の統一ファイルがあるとそのグループの級別候補は 1 件も出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: null })],
    })
    expect(listGradeCandidates([g], 'applicant', false)).toEqual([])
  })

  it('isGradeApplied の粒度: 他の級の日が applied でもその級自体の日が not_applied なら出ない', () => {
    const g = group({
      days: [
        day({ entryStatus: 'applied', eligibleGrades: ['A'] }),
        day({ entryStatus: 'not_applied', eligibleGrades: ['B'] }),
      ],
    })
    const result = listGradeCandidates([g], 'applicant', false)
    expect(result.map((r) => r.grade)).toEqual(['A'])
  })

  it('級情報が無いグループ（G(g)=∅）は級別候補に 1 件も出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: null })],
    })
    expect(listGradeCandidates([g], 'applicant', false)).toEqual([])
  })

  it('label が displayName + formatGradeLabel([grade]) になっている', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['D'] })],
    })
    const result = listGradeCandidates([g], 'applicant', false)
    expect(result[0]!.label).toBe('札幌AB D級')
  })
})

describe('confirmed — AC-16', () => {
  it('applicant ファイル（統一・級別いずれも）があっても confirmed 未取込なら confirmed 候補に出る', () => {
    const unifiedApplicant = group({
      days: [day({ entryStatus: 'applied' })],
      files: [file({ rosterType: 'applicant', grades: null })],
    })
    expect(listUnifiedCandidates([unifiedApplicant], 'confirmed', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])

    const gradeApplicant = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: ['A', 'B'] })],
    })
    expect(listUnifiedCandidates([gradeApplicant], 'confirmed', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])
    expect(listGradeCandidates([gradeApplicant], 'confirmed', false).map((r) => r.grade)).toEqual([
      'A',
      'B',
    ])
  })

  it('confirmed の統一ファイルがあると confirmed 候補には出ないが applicant 候補には出る', () => {
    const g = group({
      days: [day({ entryStatus: 'applied' })],
      files: [file({ rosterType: 'confirmed', grades: null })],
    })
    expect(listUnifiedCandidates([g], 'confirmed', false)).toEqual([])
    expect(listUnifiedCandidates([g], 'applicant', false)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
    ])
  })
})

describe('showAll トグル — AC-17', () => {
  it('showAll=true なら既定で隠れる対象（申込未・採用済み・全級カバー済み）も全部出る', () => {
    const notApplied = group({
      groupId: 1,
      days: [day({ entryStatus: 'not_applied' })],
    })
    const alreadyUnified = group({
      groupId: 2,
      days: [day({ entryStatus: 'applied' })],
      files: [file({ rosterType: 'applicant', grades: null })],
    })
    const fullyCovered = group({
      groupId: 3,
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'] })],
      files: [file({ rosterType: 'applicant', grades: ['A', 'B'] })],
    })
    const groups = [notApplied, alreadyUnified, fullyCovered]
    expect(listUnifiedCandidates(groups, 'applicant', true)).toEqual([
      { groupId: 1, displayName: '札幌AB' },
      { groupId: 2, displayName: '札幌AB' },
      { groupId: 3, displayName: '札幌AB' },
    ])
    expect(
      listGradeCandidates(groups, 'applicant', true).map((r) => `${r.groupId}:${r.grade}`),
    ).toEqual(['1:A', '1:B', '2:A', '2:B', '3:A', '3:B'])
  })

  it('showAll=true でも G(g)=∅ のグループは級別候補に出ない', () => {
    const g = group({
      days: [day({ entryStatus: 'not_applied', eligibleGrades: null })],
    })
    expect(listGradeCandidates([g], 'applicant', true)).toEqual([])
  })
})

describe('並び順', () => {
  it('候補は入力 groups の順序を保ち、級別はグループ順 → A→E 昇順になる', () => {
    const g1 = group({
      groupId: 10,
      displayName: 'グループ1',
      days: [day({ entryStatus: 'applied', eligibleGrades: ['C', 'A'] })],
    })
    const g2 = group({
      groupId: 20,
      displayName: 'グループ2',
      days: [day({ entryStatus: 'applied', eligibleGrades: ['B'] })],
    })
    const unified = listUnifiedCandidates([g2, g1], 'applicant', false)
    expect(unified.map((c) => c.groupId)).toEqual([20, 10])

    const grades = listGradeCandidates([g1, g2], 'applicant', false)
    expect(grades.map((c) => `${c.groupId}:${c.grade}`)).toEqual(['10:A', '10:C', '20:B'])
  })
})
