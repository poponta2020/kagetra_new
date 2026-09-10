import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { membershipRenewalMembers, membershipRenewals, users } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { todayInJst } from '@/lib/jst-date'
import { resolveSchoolYearApply } from './school-year'
import type { SchoolYearPatch } from './school-year'

/**
 * apply-school-year: 00:05 バッチ（`--apply-school-year`）の本体。
 *
 * `school_year_applied_at IS NULL` かつ学年の回答がある行を候補にし、対象年度の
 * 4/1（JST）以降なら `resolveSchoolYearApply` が返すパッチを `users` へ反映する
 * （requirements R4・AC-12）。
 *
 * ★`membership_renewals.status` は見ない —— 登録完了（5 月頃に完了）した後でも
 * 学年は反映されなければならない（implementation-plan「技術設計（確定）」）。
 * ★4/1 未満、または回答が不正（`schoolYearKind` が `advance`/`custom` なのに
 * `nextSchoolYear` が空）で `resolveSchoolYearApply` が `null` を返す行は
 * `applied_at` を NULL のまま残し、翌日以降の実行で改めて拾う。
 */

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

export interface ApplySchoolYearOptions {
  now?: Date
  logger?: Logger
}

export interface ApplySchoolYearResult {
  /** `school_year_applied_at IS NULL` かつ回答済みの候補行数（4/1 未満で見送った分を含む）。 */
  checked: number
  /** 実際に `users` へ反映した件数。 */
  applied: number
}

type Candidate = {
  memberId: number
  userId: string
  fiscalYear: number
  schoolYearKind: (typeof membershipRenewalMembers.$inferSelect)['schoolYearKind']
  nextFacultyKind: (typeof membershipRenewalMembers.$inferSelect)['nextFacultyKind']
  nextFaculty: string | null
  nextSchoolYear: string | null
}

/**
 * `school_year_applied_at IS NULL` かつ学年の回答がある行（4/1 未満で見送る分も
 * 含む）。`applySchoolYearForToday` と `previewSchoolYearApply`（--dry-run）が共用する。
 */
async function loadCandidates(): Promise<Candidate[]> {
  return db
    .select({
      memberId: membershipRenewalMembers.id,
      userId: membershipRenewalMembers.userId,
      fiscalYear: membershipRenewals.fiscalYear,
      schoolYearKind: membershipRenewalMembers.schoolYearKind,
      nextFacultyKind: membershipRenewalMembers.nextFacultyKind,
      nextFaculty: membershipRenewalMembers.nextFaculty,
      nextSchoolYear: membershipRenewalMembers.nextSchoolYear,
    })
    .from(membershipRenewalMembers)
    .innerJoin(membershipRenewals, eq(membershipRenewals.id, membershipRenewalMembers.renewalId))
    .where(
      and(
        isNull(membershipRenewalMembers.schoolYearAppliedAt),
        isNotNull(membershipRenewalMembers.schoolYearKind),
      ),
    )
}

/**
 * `membershipRenewalMembers.id` を CAS の鍵に `UPDATE … WHERE school_year_applied_at
 * IS NULL` で先に applied_at を確定させてから `users` を更新する。回答 Action 側の
 * 即時反映（4/1 以降の回答）と同じ列を見るので、レースしても二重反映しない。
 */
export async function applySchoolYearForToday(
  opts: ApplySchoolYearOptions = {},
): Promise<ApplySchoolYearResult> {
  const now = opts.now ?? new Date()
  const logger = opts.logger ?? NOOP_LOGGER
  const todayJst = todayInJst(now)

  const candidates = await loadCandidates()

  let applied = 0
  for (const row of candidates) {
    const patch = resolveSchoolYearApply(
      {
        schoolYearKind: row.schoolYearKind,
        nextFacultyKind: row.nextFacultyKind,
        nextFaculty: row.nextFaculty,
        nextSchoolYear: row.nextSchoolYear,
      },
      todayJst,
      row.fiscalYear,
    )
    if (!patch) continue

    const ok = await db.transaction(async (tx) => {
      const updatedMember = await tx
        .update(membershipRenewalMembers)
        .set({ schoolYearAppliedAt: now, updatedAt: now })
        .where(
          and(
            eq(membershipRenewalMembers.id, row.memberId),
            isNull(membershipRenewalMembers.schoolYearAppliedAt),
          ),
        )
        .returning({ id: membershipRenewalMembers.id })
      if (updatedMember.length === 0) return false
      await tx.update(users).set({ ...patch, updatedAt: now }).where(eq(users.id, row.userId))
      return true
    })

    if (ok) {
      applied++
    } else {
      logger.warn('renewal apply-school-year: CAS lost (already applied)', { memberId: row.memberId })
    }
  }

  logger.info('renewal apply-school-year: done', { checked: candidates.length, applied })
  return { checked: candidates.length, applied }
}

// ---------------------------------------------------------------------------
// --dry-run（scripts/renewal-daily.ts が呼ぶ）
// ---------------------------------------------------------------------------

export interface SchoolYearApplyCandidatePreview {
  userId: string
  fiscalYear: number
  patch: SchoolYearPatch
}

/**
 * `--dry-run` 用の候補プレビュー。`applySchoolYearForToday` と同じ候補集合から
 * `resolveSchoolYearApply` が `null` でないもの（＝今回反映される見込みの行）だけを
 * 返す。読み取りのみで `users`／`membership_renewal_members` への書き込みは行わない。
 */
export async function previewSchoolYearApply(
  opts: { now?: Date } = {},
): Promise<SchoolYearApplyCandidatePreview[]> {
  const now = opts.now ?? new Date()
  const todayJst = todayInJst(now)
  const candidates = await loadCandidates()

  const preview: SchoolYearApplyCandidatePreview[] = []
  for (const row of candidates) {
    const patch = resolveSchoolYearApply(
      {
        schoolYearKind: row.schoolYearKind,
        nextFacultyKind: row.nextFacultyKind,
        nextFaculty: row.nextFaculty,
        nextSchoolYear: row.nextSchoolYear,
      },
      todayJst,
      row.fiscalYear,
    )
    if (patch) preview.push({ userId: row.userId, fiscalYear: row.fiscalYear, patch })
  }
  return preview
}
