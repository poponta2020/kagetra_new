import { describe, expect, it } from 'vitest'
import {
  formatGroupDayRange,
  listProcessCandidates,
  selectableGradesForGroup,
  toRosterAdoptGroup,
  type ProcessCandidateDay,
  type ProcessCandidateGroup,
} from './process-candidate-utils'

function day(overrides: Partial<ProcessCandidateDay> = {}): ProcessCandidateDay {
  return {
    eventDate: '2026-08-01',
    entryStatus: 'applied',
    eligibleGrades: ['A', 'B'],
    kind: 'individual',
    ...overrides,
  }
}

function group(overrides: Partial<ProcessCandidateGroup> = {}): ProcessCandidateGroup {
  return {
    groupId: 1,
    displayName: '札幌AB',
    representativeEventId: 100,
    days: [day()],
    files: [],
    lineLinked: true,
    ...overrides,
  }
}

const CUTOFF = '2026-07-01'

describe('listProcessCandidates（kind=none）— AC-6', () => {
  it('団体戦のみ ∧ cutoff 内のグループが候補に残る', () => {
    const g = group({ days: [day({ kind: 'team', eventDate: '2026-08-01' })] })
    const result = listProcessCandidates([g], { kind: 'none', cutoffStr: CUTOFF, showAll: false })
    expect(result).toEqual([g])
  })

  it('cutoff より古い日しか無いグループは落ちる', () => {
    const g = group({ days: [day({ eventDate: '2026-06-01' })] })
    const result = listProcessCandidates([g], { kind: 'none', cutoffStr: CUTOFF, showAll: false })
    expect(result).toEqual([])
  })

  it('showAll は未選択には影響しない（既定フィルタが存在しない）', () => {
    const g = group({ days: [day({ eventDate: '2026-08-01' })] })
    const withoutShowAll = listProcessCandidates([g], {
      kind: 'none',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    const withShowAll = listProcessCandidates([g], {
      kind: 'none',
      cutoffStr: CUTOFF,
      showAll: true,
    })
    expect(withoutShowAll).toEqual(withShowAll)
    expect(withoutShowAll).toEqual([g])
  })
})

describe('listProcessCandidates（名簿種別）— AC-6', () => {
  it('団体戦のみのグループは applicant_roster では落ちる', () => {
    const g = group({ days: [day({ kind: 'team', eventDate: '2026-08-01' })] })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: true,
    })
    expect(result).toEqual([])
  })

  it('★穴の回帰: 団体戦だけが cutoff 内・個人戦は cutoff より古いグループは名簿種別で落ちる', () => {
    const g = group({
      days: [
        day({ kind: 'team', eventDate: '2026-08-01' }),
        day({ kind: 'individual', eventDate: '2026-06-01' }),
      ],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: true,
    })
    expect(result).toEqual([])
  })

  it('個人戦 ∧ cutoff 内の日を持つグループは showAll=true で残る', () => {
    const g = group({
      days: [
        day({ kind: 'team', eventDate: '2026-06-01' }),
        day({ kind: 'individual', eventDate: '2026-08-01' }),
      ],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: true,
    })
    expect(result).toEqual([g])
  })
})

describe('showAll=false の既定フィルタ — AC-7', () => {
  it('未申込のグループは落ちる', () => {
    const g = group({
      days: [day({ entryStatus: 'not_applied', eventDate: '2026-08-01' })],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    expect(result).toEqual([])
  })

  it('統一ファイル採用済みのグループは落ちる', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eventDate: '2026-08-01' })],
      files: [{ rosterType: 'applicant', grades: null }],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    expect(result).toEqual([])
  })

  it('級別ファイルで全級カバー済みのグループは落ちる', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eligibleGrades: ['A', 'B'], eventDate: '2026-08-01' })],
      files: [{ rosterType: 'applicant', grades: ['A', 'B'] }],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    expect(result).toEqual([])
  })

  it('申込済み ∧ 未取込のグループは既定フィルタで残る', () => {
    const g = group({
      days: [day({ entryStatus: 'applied', eventDate: '2026-08-01' })],
    })
    const result = listProcessCandidates([g], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    expect(result).toEqual([g])
  })

  it('showAll=true なら既定フィルタで落ちる対象も全部残る', () => {
    const notApplied = group({
      groupId: 1,
      days: [day({ entryStatus: 'not_applied', eventDate: '2026-08-01' })],
    })
    const alreadyUnified = group({
      groupId: 2,
      days: [day({ entryStatus: 'applied', eventDate: '2026-08-01' })],
      files: [{ rosterType: 'applicant', grades: null }],
    })
    const groups = [notApplied, alreadyUnified]
    const result = listProcessCandidates(groups, {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: true,
    })
    expect(result).toEqual(groups)
  })

  it('入力の並び順を保つ', () => {
    const g1 = group({ groupId: 10, days: [day({ eventDate: '2026-08-01' })] })
    const g2 = group({ groupId: 20, days: [day({ eventDate: '2026-08-02' })] })
    const result = listProcessCandidates([g2, g1], {
      kind: 'applicant_roster',
      cutoffStr: CUTOFF,
      showAll: false,
    })
    expect(result.map((g) => g.groupId)).toEqual([20, 10])
  })
})

describe('lineLinked はフィルタで落とさない', () => {
  it('lineLinked=false でも候補には残る（選択自体は可能・配信チェックだけ無効）', () => {
    const g = group({
      lineLinked: false,
      days: [day({ eventDate: '2026-08-01' })],
    })
    const result = listProcessCandidates([g], { kind: 'none', cutoffStr: CUTOFF, showAll: false })
    expect(result).toEqual([g])
    expect(result[0]!.lineLinked).toBe(false)
  })
})

describe('toRosterAdoptGroup / selectableGradesForGroup', () => {
  it('団体戦の日を落とす（団体戦の日にだけ E 級がある構成で E 級が出ない）', () => {
    const g = group({
      days: [
        day({ kind: 'individual', eligibleGrades: ['A', 'B'] }),
        day({ kind: 'team', eligibleGrades: ['E'] }),
      ],
    })
    const converted = toRosterAdoptGroup(g)
    expect(converted.days).toHaveLength(1)
    expect(selectableGradesForGroup(g)).toEqual(['A', 'B'])
  })
})

describe('formatGroupDayRange', () => {
  it('0 件なら空文字', () => {
    expect(formatGroupDayRange([])).toBe('')
  })

  it('1 件ならその日付そのまま', () => {
    expect(formatGroupDayRange([day({ eventDate: '2026-09-13' })])).toBe('2026-09-13')
  })

  it('複数日なら最小〜最大', () => {
    expect(
      formatGroupDayRange([
        day({ eventDate: '2026-09-14' }),
        day({ eventDate: '2026-09-13' }),
      ]),
    ).toBe('2026-09-13〜2026-09-14')
  })
})
