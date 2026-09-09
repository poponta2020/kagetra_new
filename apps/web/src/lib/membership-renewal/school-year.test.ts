import { describe, it, expect } from 'vitest'
import {
  defaultNextSchoolYear,
  finalSchoolYearFor,
  isFinalSchoolYear,
  resolveSchoolYearApply,
  type SchoolYearAnswer,
} from './school-year'

describe('finalSchoolYearFor / isFinalSchoolYear（最終学年判定・AC-11）', () => {
  it('学部（6 年制以外）は 4 年が最終学年', () => {
    expect(finalSchoolYearFor('undergraduate', '工学部')).toBe('4年')
    expect(isFinalSchoolYear('undergraduate', '工学部', '4年')).toBe(true)
    expect(isFinalSchoolYear('undergraduate', '工学部', '3年')).toBe(false)
  })

  it('6 年制学部（医・歯・薬・獣医）は 6 年が最終学年', () => {
    expect(finalSchoolYearFor('undergraduate', '医学部')).toBe('6年')
    expect(isFinalSchoolYear('undergraduate', '医学部', '6年')).toBe(true)
    // 6 年制でも 4 年時点はまだ最終学年ではない。
    expect(isFinalSchoolYear('undergraduate', '医学部', '4年')).toBe(false)
  })

  it('候補外・部分一致の学部名は 6 年制と誤判定しない（完全一致のみ）', () => {
    expect(finalSchoolYearFor('undergraduate', '医学部保健学科')).toBe('4年')
  })

  it('大学院: 修士2年・博士3年・専門職3年が最終学年（4種のうち残り3種）', () => {
    expect(isFinalSchoolYear('graduate', '情報科学院', '修士2年')).toBe(true)
    expect(isFinalSchoolYear('graduate', '情報科学院', '博士3年')).toBe(true)
    expect(isFinalSchoolYear('graduate', '情報科学院', '専門職3年')).toBe(true)
    expect(isFinalSchoolYear('graduate', '情報科学院', '修士1年')).toBe(false)
    expect(isFinalSchoolYear('graduate', '情報科学院', '博士1年')).toBe(false)
  })

  it('faculty が null の学部は 4 年扱い（6 年制と判定しない）', () => {
    expect(finalSchoolYearFor('undergraduate', null)).toBe('4年')
  })

  it('kind が null なら null/false', () => {
    expect(finalSchoolYearFor(null, '工学部')).toBeNull()
    expect(isFinalSchoolYear(null, '工学部', '4年')).toBe(false)
  })

  it('schoolYear が null なら false', () => {
    expect(isFinalSchoolYear('undergraduate', '工学部', null)).toBe(false)
  })
})

describe('defaultNextSchoolYear（既定値 = 1 つ進めた学年・AC-11）', () => {
  it('学部は SCHOOL_YEAR_ORDER の並びで +1', () => {
    expect(defaultNextSchoolYear('undergraduate', '1年')).toBe('2年')
    expect(defaultNextSchoolYear('undergraduate', '3年')).toBe('4年')
  })

  it('大学院も同様に +1', () => {
    expect(defaultNextSchoolYear('graduate', '修士1年')).toBe('修士2年')
  })

  it('現在の学年が未設定なら既定値なし', () => {
    expect(defaultNextSchoolYear('undergraduate', null)).toBeNull()
  })

  it('候補外の学年は既定値なし', () => {
    expect(defaultNextSchoolYear('undergraduate', '存在しない学年')).toBeNull()
  })

  it('kind が null なら既定値なし', () => {
    expect(defaultNextSchoolYear(null, '1年')).toBeNull()
  })
})

describe('resolveSchoolYearApply（4/1 反映・AC-12）', () => {
  const baseAnswer: SchoolYearAnswer = {
    schoolYearKind: 'advance',
    nextFacultyKind: null,
    nextFaculty: null,
    nextSchoolYear: '4年',
  }

  it('4/1 より前（3/31）は反映しない', () => {
    expect(resolveSchoolYearApply(baseAnswer, '2026-03-31', 2026)).toBeNull()
  })

  it('4/1 当日以降は反映する（境界）', () => {
    expect(resolveSchoolYearApply(baseAnswer, '2026-04-01', 2026)).toEqual({ schoolYear: '4年' })
  })

  it('4/1 より後も反映する', () => {
    expect(resolveSchoolYearApply(baseAnswer, '2026-05-01', 2026)).toEqual({ schoolYear: '4年' })
  })

  it('custom（留年・転学部等）も同様に反映する', () => {
    const answer: SchoolYearAnswer = { ...baseAnswer, schoolYearKind: 'custom', nextSchoolYear: '3年' }
    expect(resolveSchoolYearApply(answer, '2026-04-01', 2026)).toEqual({ schoolYear: '3年' })
  })

  it('進学（advance で学部区分・学部等名も入っている）は facultyKind/faculty も含める', () => {
    const answer: SchoolYearAnswer = {
      schoolYearKind: 'advance',
      nextFacultyKind: 'graduate',
      nextFaculty: '情報科学院',
      nextSchoolYear: '修士1年',
    }
    expect(resolveSchoolYearApply(answer, '2026-04-01', 2026)).toEqual({
      facultyKind: 'graduate',
      faculty: '情報科学院',
      schoolYear: '修士1年',
    })
  })

  it('leave（卒業）は isCircleMember=false のみ（学部等名・学年は残す）', () => {
    const answer: SchoolYearAnswer = {
      schoolYearKind: 'leave',
      nextFacultyKind: null,
      nextFaculty: null,
      nextSchoolYear: null,
    }
    expect(resolveSchoolYearApply(answer, '2026-04-01', 2026)).toEqual({ isCircleMember: false })
  })

  it('schoolYearKind が null（未回答）なら反映しない', () => {
    const answer: SchoolYearAnswer = {
      schoolYearKind: null,
      nextFacultyKind: null,
      nextFaculty: null,
      nextSchoolYear: null,
    }
    expect(resolveSchoolYearApply(answer, '2026-04-01', 2026)).toBeNull()
  })

  it('advance/custom で nextSchoolYear が空（不正な回答）なら反映しない', () => {
    const answer: SchoolYearAnswer = {
      schoolYearKind: 'advance',
      nextFacultyKind: null,
      nextFaculty: null,
      nextSchoolYear: null,
    }
    expect(resolveSchoolYearApply(answer, '2026-04-01', 2026)).toBeNull()
  })
})
