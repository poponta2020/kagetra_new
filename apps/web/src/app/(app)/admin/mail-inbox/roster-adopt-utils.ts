/**
 * メール詳細「名簿ファイルとして採用」シートの対象候補を計算する純関数群
 * （roster-file-adoption 2026-08-01 改修 §3.2.7）。
 *
 * ★このファイルは `'use client'` の RosterFileAdoptSheet.tsx から import される
 * **DB 非依存の leaf** でなければならない。`@kagetra/shared/schema` /
 * `@/lib/entry-groups` / `drizzle-orm` などの値 import（型 import も含む）を
 * 書くと、client バンドルへ DB 依存が漏れる。これは eslint / vitest / check-types
 * のどれでも検知できず `next build` で初めて壊れる（既知の罠。
 * `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` 冒頭のコメント参照）。
 * そのため `Grade` すら shared から取らず、このファイル内で自前定義する。
 *
 * `Date.now()` / `new Date()` も読まない（cutoff・todayStr はサーバーが注入する
 * 既存規約。entry-board-utils.ts と同じ方針）。
 */

export type RosterAdoptGrade = 'A' | 'B' | 'C' | 'D' | 'E'
export type RosterAdoptRosterType = 'applicant' | 'confirmed'

/**
 * グループ内の 1 日ぶんの最小行。
 * ★母集団は「個人戦 ∧ status<>'cancelled'」の**全日**で、開催日 cutoff は掛かって
 * いない。サーバーが「cutoff を満たす日が 1 つ以上あるグループ」だけを渡すことを
 * 保証するので、この純関数は基本条件（§3.2.7）を再チェックしない。
 */
export interface RosterAdoptGroupDay {
  /** YYYY-MM-DD。現状フィルタでは使わないが、UI の候補表示（開催日）に使うので DTO に含める。 */
  eventDate: string
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  eligibleGrades: RosterAdoptGrade[] | null
}

/** そのグループに既に採用済みの名簿ファイル 1 件。grades が null ならグループ統一。 */
export interface RosterAdoptExistingFile {
  rosterType: RosterAdoptRosterType
  grades: RosterAdoptGrade[] | null
}

export interface RosterAdoptGroup {
  groupId: number
  /** サーバーで導出済みの表示名（通称ベース。クライアントでは計算しない）。 */
  displayName: string
  days: RosterAdoptGroupDay[]
  files: RosterAdoptExistingFile[]
}

/** グループ統一モードの候補 1 件。 */
export interface RosterAdoptUnifiedCandidate {
  groupId: number
  displayName: string
}

/** 級別モードの候補 1 件（グループ×級）。 */
export interface RosterAdoptGradeCandidate {
  groupId: number
  displayName: string
  grade: RosterAdoptGrade
  /** 候補の表示ラベル（例「札幌AB D級」）＝ `${displayName} ${formatGradeLabel([grade])}`。 */
  label: string
}

export const ROSTER_ADOPT_GRADE_ORDER: readonly RosterAdoptGrade[] = [
  'A',
  'B',
  'C',
  'D',
  'E',
]

const GRADE_SET: ReadonlySet<string> = new Set(ROSTER_ADOPT_GRADE_ORDER)

/** dedupe + A→E 昇順に正規化する。未知の値は落とす。 */
export function normalizeGrades(
  grades: readonly string[],
): RosterAdoptGrade[] {
  const set = new Set(grades.filter((g): g is RosterAdoptGrade => GRADE_SET.has(g)))
  return ROSTER_ADOPT_GRADE_ORDER.filter((g) => set.has(g))
}

/** 級ラベル。['D'] → 'D級' / ['A','B'] → 'A・B級' / 空配列 → ''。入力は正規化してから連結する。 */
export function formatGradeLabel(grades: readonly RosterAdoptGrade[]): string {
  const normalized = normalizeGrades(grades)
  if (normalized.length === 0) return ''
  return `${normalized.join('・')}級`
}

/** グループの級集合 G(g) = 日別 eligibleGrades の和集合（A→E 昇順・重複なし）。 */
export function groupGradeSet(group: RosterAdoptGroup): RosterAdoptGrade[] {
  const set = new Set<string>()
  for (const day of group.days) {
    if (day.eligibleGrades == null) continue
    for (const g of day.eligibleGrades) set.add(g)
  }
  return normalizeGrades([...set])
}

/** applied(g) = いずれかの日が entryStatus==='applied'。 */
export function isGroupApplied(group: RosterAdoptGroup): boolean {
  return group.days.some((d) => d.entryStatus === 'applied')
}

/** appliedGrade(g,gr) = gr を eligibleGrades に含む日のいずれかが applied。 */
export function isGradeApplied(
  group: RosterAdoptGroup,
  grade: RosterAdoptGrade,
): boolean {
  return group.days.some(
    (d) => d.entryStatus === 'applied' && (d.eligibleGrades?.includes(grade) ?? false),
  )
}

/** そのグループ×種別に級指定なしの採用（統一ファイル）があるか。 */
function hasUnifiedFile(
  group: RosterAdoptGroup,
  rosterType: RosterAdoptRosterType,
): boolean {
  return group.files.some((f) => f.rosterType === rosterType && f.grades == null)
}

/** そのグループ×種別の級別採用ファイルがカバーする級の和集合（A→E 昇順）。 */
function gradeFileUnion(
  group: RosterAdoptGroup,
  rosterType: RosterAdoptRosterType,
): RosterAdoptGrade[] {
  const set = new Set<string>()
  for (const f of group.files) {
    if (f.rosterType !== rosterType || f.grades == null) continue
    for (const g of f.grades) set.add(g)
  }
  return normalizeGrades([...set])
}

/**
 * G(g) が gradeUnion に全部含まれているか（＝級別ファイルが全級をカバー済みか）。
 * G(g)=∅（級情報なしグループ）は「カバー済み」とは判定しない（要件 §3.2.7 の注記）
 * ——このケースは呼び出し側で G(g)≠∅ と合わせて判定する。
 */
function isFullyCoveredByGradeFiles(
  groupGrades: readonly RosterAdoptGrade[],
  gradeUnion: readonly RosterAdoptGrade[],
): boolean {
  if (groupGrades.length === 0) return false
  const unionSet = new Set(gradeUnion)
  return groupGrades.every((g) => unionSet.has(g))
}

/** グループ統一モードの候補一覧。showAll=true なら基本条件のみ（＝全グループ）。 */
export function listUnifiedCandidates(
  groups: readonly RosterAdoptGroup[],
  rosterType: RosterAdoptRosterType,
  showAll: boolean,
): RosterAdoptUnifiedCandidate[] {
  const out: RosterAdoptUnifiedCandidate[] = []
  for (const group of groups) {
    if (showAll) {
      out.push({ groupId: group.groupId, displayName: group.displayName })
      continue
    }
    if (!isGroupApplied(group)) continue
    if (hasUnifiedFile(group, rosterType)) continue
    const groupGrades = groupGradeSet(group)
    const gradeUnion = gradeFileUnion(group, rosterType)
    if (isFullyCoveredByGradeFiles(groupGrades, gradeUnion)) continue
    out.push({ groupId: group.groupId, displayName: group.displayName })
  }
  return out
}

/** 級別モードの候補一覧。showAll=true なら全 (g, gr∈G(g))。 */
export function listGradeCandidates(
  groups: readonly RosterAdoptGroup[],
  rosterType: RosterAdoptRosterType,
  showAll: boolean,
): RosterAdoptGradeCandidate[] {
  const out: RosterAdoptGradeCandidate[] = []
  for (const group of groups) {
    // groupGradeSet は既に A→E 昇順で返るので、そのまま列挙すればグループ内の
    // 並び順要件（グループ順 → A→E 昇順）を満たす。
    const groupGrades = groupGradeSet(group)
    const hasUnified = hasUnifiedFile(group, rosterType)
    const gradeUnion = gradeFileUnion(group, rosterType)
    for (const grade of groupGrades) {
      if (showAll) {
        out.push({
          groupId: group.groupId,
          displayName: group.displayName,
          grade,
          label: `${group.displayName} ${formatGradeLabel([grade])}`,
        })
        continue
      }
      if (hasUnified) continue
      if (gradeUnion.includes(grade)) continue
      if (!isGradeApplied(group, grade)) continue
      out.push({
        groupId: group.groupId,
        displayName: group.displayName,
        grade,
        label: `${group.displayName} ${formatGradeLabel([grade])}`,
      })
    }
  }
  return out
}
