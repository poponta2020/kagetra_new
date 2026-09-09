import {
  GRADUATE_FINAL_YEARS,
  RENEWAL_SCHOOL_YEAR_OPTIONS,
  SIX_YEAR_FACULTIES,
  SIX_YEAR_FINAL_YEAR,
  UNDERGRADUATE_FINAL_YEAR,
  type FacultyKind,
  type RenewalSchoolYearKind,
} from '@kagetra/shared'

/**
 * 学年セクションの最終学年判定・既定値・4/1 反映の純ロジック（requirements R4・AC-11・AC-12）。
 */

/**
 * `kind`/`faculty` の組み合わせの最終学年を返す。
 *
 * - 学部（undergraduate）: `faculty` が `SIX_YEAR_FACULTIES` に**完全一致**すれば
 *   `SIX_YEAR_FINAL_YEAR`（6年）、それ以外（`faculty` が null/候補外含む）は
 *   `UNDERGRADUATE_FINAL_YEAR`（4年）
 * - 大学院（graduate）: 課程（修士/博士/専門職）によって最終学年が 3 通り
 *   （`GRADUATE_FINAL_YEARS`）に分かれ、`faculty`（学部等名＝研究科名）だけでは
 *   単一値に決まらない。この関数では `null` を返し、`isFinalSchoolYear` は
 *   学年の文字列自体を `GRADUATE_FINAL_YEARS` と照合する（下記参照）
 * - `kind` が `null` も `null`
 */
export function finalSchoolYearFor(kind: FacultyKind | null, faculty: string | null): string | null {
  if (kind === 'undergraduate') {
    return faculty != null && SIX_YEAR_FACULTIES.includes(faculty)
      ? SIX_YEAR_FINAL_YEAR
      : UNDERGRADUATE_FINAL_YEAR
  }
  // graduate または kind===null。
  return null
}

/**
 * 現在の学年が最終学年かどうか。
 * 学部は `finalSchoolYearFor` の単一値と比較、大学院は学年文字列そのものを
 * `GRADUATE_FINAL_YEARS`（修士2年/博士3年/専門職3年）と照合する
 * （`faculty` は大学院の最終学年判定には使わない）。
 */
export function isFinalSchoolYear(
  kind: FacultyKind | null,
  faculty: string | null,
  schoolYear: string | null,
): boolean {
  if (!kind || !schoolYear) return false
  if (kind === 'undergraduate') {
    return finalSchoolYearFor(kind, faculty) === schoolYear
  }
  return GRADUATE_FINAL_YEARS.includes(schoolYear)
}

/**
 * 「4 月からの学年」の既定値（現在の学年を `schoolYearOptions(kind)` の並びで
 * 1 つ進めたもの）。現在の学年が未設定・候補外なら `null`。現在の学年が
 * 選択肢の末尾（配列上「次」が無い）ときも `null`。
 *
 * ★呼び出し側は `isFinalSchoolYear` を**先に**呼んで最終学年なら既定値を使わず
 * 3 択（進学/卒業/留年）を出す（R4）。大学院の 修士2年→博士1年 のように
 * 配列上は「次」があっても実際には進学扱いすべきケースは、この関数単体では
 * 判別できないため `isFinalSchoolYear` 側でゲートする設計にしている。
 */
export function defaultNextSchoolYear(
  kind: FacultyKind | null,
  schoolYear: string | null,
): string | null {
  if (!kind || !schoolYear) return null
  const options = RENEWAL_SCHOOL_YEAR_OPTIONS[kind]
  const index = options.indexOf(schoolYear)
  if (index === -1) return null
  return options[index + 1] ?? null
}

/** 学年セクションの回答（`membership_renewal_members` の学年回答列に対応）。 */
export type SchoolYearAnswer = {
  schoolYearKind: RenewalSchoolYearKind | null
  nextFacultyKind: FacultyKind | null
  nextFaculty: string | null
  nextSchoolYear: string | null
}

/** `users` へ反映するパッチ（4/1 以降にのみ生成される）。 */
export type SchoolYearPatch = {
  facultyKind?: FacultyKind
  faculty?: string
  schoolYear?: string
  isCircleMember?: boolean
}

/**
 * 学年の回答を `users` へ反映するパッチへ解決する（requirements R4・AC-12）。
 *
 * `todayJst` が対象年度の 4/1（JST）**より前**なら反映しない（`null`）。
 * 4/1 以降なら:
 * - `leave`（卒業・サークルを離れる）→ `{ isCircleMember: false }`
 *   （学部等名・学年は残すので patch に含めない）
 * - `advance`/`custom` → `{ schoolYear: nextSchoolYear, ... }`。
 *   `nextFacultyKind`/`nextFaculty` が入っていれば進学として一緒に反映する
 * - `schoolYearKind` が `null`（未回答）、または `advance`/`custom` で
 *   `nextSchoolYear` が空（不正な回答）なら `null`（反映しない）
 *
 * 反映内容は回答時点の**絶対値**（`nextSchoolYear` 等）をそのまま使い、
 * 4/1 の時点で再計算しない（implementation-plan の技術設計で確定）。
 */
export function resolveSchoolYearApply(
  answer: SchoolYearAnswer,
  todayJst: string,
  fiscalYear: number,
): SchoolYearPatch | null {
  const fiscalYearStart = `${fiscalYear}-04-01`
  if (todayJst < fiscalYearStart) return null

  if (answer.schoolYearKind === 'leave') {
    return { isCircleMember: false }
  }
  if (answer.schoolYearKind === 'advance' || answer.schoolYearKind === 'custom') {
    if (!answer.nextSchoolYear) return null
    const patch: SchoolYearPatch = { schoolYear: answer.nextSchoolYear }
    if (answer.nextFacultyKind != null) patch.facultyKind = answer.nextFacultyKind
    if (answer.nextFaculty != null) patch.faculty = answer.nextFaculty
    return patch
  }
  // schoolYearKind が null（未回答）。
  return null
}
