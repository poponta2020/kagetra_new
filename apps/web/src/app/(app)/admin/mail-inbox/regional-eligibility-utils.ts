/**
 * mail-ai-extract-refinements §3.2.12(d): D・E 級の地域制限判定を承認フォームの
 * 初期値へ反映する純関数。**DB 非依存の leaf** — `'use client'` の
 * `ApprovalForm.tsx` から import される（`process-candidate-utils.ts` 冒頭コメント
 * と同じ規律）ので `@kagetra/shared/schema` / `@/lib/*` / drizzle / `node:` を
 * import しない。定数は依存ゼロの `@kagetra/mail-worker/classify/regional` から
 * 取る（`RegionalEligibility` 型だけは `classify/schema` から type-only import —
 * 型は erase されるのでバンドルへは載らない）。
 *
 * 外す条件は 3 つ全てを満たすときだけ（要件 §3.2.12(d) の表・技術設計）:
 *   1. `verdict === 北海道は対象外`
 *   2. `evidence_verified === true`（ワーカーが原文と機械照合済み）
 *   3. その級が `unit.eligible_grades` に含まれる（含まれない級の判定は notices
 *      にも出さず無視する）
 *
 * `制限なし` は notices に出さない（AI 抽出結果ビューで見られるため）。
 * `regional_eligibility` が欠落・空、または `eligible_grades` が空/`null` の
 * ときは何もしない（3.0.x 以前のドラフトは判定を持たない）。
 */
import {
  VERDICT_HOME_ELIGIBLE,
  VERDICT_HOME_INELIGIBLE,
  VERDICT_NEEDS_REVIEW,
  VERDICT_UNRESTRICTED,
} from '@kagetra/mail-worker/classify/regional'
import type { RegionalEligibility } from '@kagetra/mail-worker/classify/schema'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
type RegionalEligibilityGrade = 'D' | 'E'

export type RegionalEligibilityNoticeKind =
  | 'removed'
  | 'unverified'
  | 'review'
  | 'eligible'

export interface RegionalEligibilityNoticeItem {
  grade: RegionalEligibilityGrade
  kind: RegionalEligibilityNoticeKind
  quote: string | null
}

export interface RegionalEligibilityPlan {
  /** 照合済み対象外で対象級から外れた級。順序は `regional_eligibility` の記載順。 */
  removedGrades: RegionalEligibilityGrade[]
  /**
   * 対象級の初期値。何も外れなければ `unit.eligible_grades` をそのまま
   * （`null` も維持）。`EventForm` の `defaultValues.eligibleGrades`
   * （`string[] | null`）へそのまま渡せるよう、意図的に非 readonly。
   */
  effectiveGrades: Grade[] | null
  /** `eligible_grades` が非空かつ `effectiveGrades` が空になったとき true。 */
  allRemoved: boolean
  /** `regional_eligibility` の記載順。「制限なし」は含まない。 */
  notices: RegionalEligibilityNoticeItem[]
}

export interface RegionalEligibilityUnitInput {
  eligible_grades: Grade[] | null
  regional_eligibility?: readonly RegionalEligibility[]
}

export function planRegionalEligibility(
  unit: RegionalEligibilityUnitInput,
): RegionalEligibilityPlan {
  const eligibleGrades = unit.eligible_grades
  const regionalEligibility = unit.regional_eligibility

  if (
    !eligibleGrades ||
    eligibleGrades.length === 0 ||
    !regionalEligibility ||
    regionalEligibility.length === 0
  ) {
    return {
      removedGrades: [],
      effectiveGrades: eligibleGrades ?? null,
      allRemoved: false,
      notices: [],
    }
  }

  const removedGrades: RegionalEligibilityGrade[] = []
  const notices: RegionalEligibilityNoticeItem[] = []

  for (const entry of regionalEligibility) {
    // その単位の対象級に無い級の判定は無視する（notices にも出さない）。
    if (!eligibleGrades.includes(entry.grade)) continue

    if (entry.verdict === VERDICT_UNRESTRICTED) continue

    if (entry.verdict === VERDICT_HOME_INELIGIBLE) {
      if (entry.evidence_verified === true) {
        removedGrades.push(entry.grade)
        notices.push({ grade: entry.grade, kind: 'removed', quote: entry.evidence_quote })
      } else {
        notices.push({ grade: entry.grade, kind: 'unverified', quote: entry.evidence_quote })
      }
      continue
    }

    if (entry.verdict === VERDICT_NEEDS_REVIEW) {
      notices.push({ grade: entry.grade, kind: 'review', quote: entry.evidence_quote })
      continue
    }

    if (entry.verdict === VERDICT_HOME_ELIGIBLE) {
      notices.push({ grade: entry.grade, kind: 'eligible', quote: entry.evidence_quote })
    }
  }

  const effectiveGrades =
    removedGrades.length === 0
      ? eligibleGrades
      : eligibleGrades.filter((g) => !removedGrades.includes(g as RegionalEligibilityGrade))
  const allRemoved = eligibleGrades.length > 0 && effectiveGrades.length === 0

  return { removedGrades, effectiveGrades, allRemoved, notices }
}
