import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import {
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosterEntries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'

type DbLike = NodePgDatabase<typeof schema>

export type LotteryGrade = 'A' | 'B' | 'C' | 'D' | 'E'
export type LotterySelectionStatus = 'lottery' | 'under_capacity' | 'no_capacity' | 'unknown'
export type RosterPurpose = 'applicant' | 'selection_result' | 'confirmed_publication'

export interface GradeAdoptionConfig {
  grade: LotteryGrade
  selectionStatus: LotterySelectionStatus
  capacity: number | null
  applicationStartDate: string | null
  /** 原本が申込名簿と確定名簿を兼ねると明示している場合だけ true。 */
  publishAsConfirmed: boolean
}

export interface ActiveLotteryFact {
  id: number
  editionId: number
  grade: LotteryGrade
  selectionStatus: LotterySelectionStatus
  capacity: number | null
  applicationStartDate: string | null
  applicantRosterId: number | null
  selectionResultRosterId: number | null
  actualResultClassId: number | null
  selectionRuleVersion: string | null
  sourceMailMessageId: number | null
  verifiedAt: Date | null
  verifiedByUserId: string | null
}

const factProjection = {
  id: tournamentEditionGradeLotteryFacts.id,
  editionId: tournamentEditionGradeLotteryFacts.editionId,
  grade: tournamentEditionGradeLotteryFacts.grade,
  selectionStatus: tournamentEditionGradeLotteryFacts.selectionStatus,
  capacity: tournamentEditionGradeLotteryFacts.capacity,
  applicationStartDate: tournamentEditionGradeLotteryFacts.applicationStartDate,
  applicantRosterId: tournamentEditionGradeLotteryFacts.applicantRosterId,
  selectionResultRosterId: tournamentEditionGradeLotteryFacts.selectionResultRosterId,
  actualResultClassId: tournamentEditionGradeLotteryFacts.actualResultClassId,
  selectionRuleVersion: tournamentEditionGradeLotteryFacts.selectionRuleVersion,
  sourceMailMessageId: tournamentEditionGradeLotteryFacts.sourceMailMessageId,
  verifiedAt: tournamentEditionGradeLotteryFacts.verifiedAt,
  verifiedByUserId: tournamentEditionGradeLotteryFacts.verifiedByUserId,
}

/** Locking the edition serializes creation as well as replacement of its active facts. */
export async function lockLotteryEdition(tx: DbLike, editionId: number) {
  const [edition] = await tx
    .select({
      id: tournamentSeriesEditions.id,
      seriesId: tournamentSeriesEditions.seriesId,
    })
    .from(tournamentSeriesEditions)
    .where(eq(tournamentSeriesEditions.id, editionId))
    .for('update')
  if (!edition) throw new Error('開催回が見つかりません')
  return edition
}

export async function loadActiveLotteryFact(
  tx: DbLike,
  editionId: number,
  grade: LotteryGrade,
): Promise<ActiveLotteryFact | null> {
  const [fact] = await tx
    .select(factProjection)
    .from(tournamentEditionGradeLotteryFacts)
    .where(
      and(
        eq(tournamentEditionGradeLotteryFacts.editionId, editionId),
        eq(tournamentEditionGradeLotteryFacts.grade, grade),
        sql`${tournamentEditionGradeLotteryFacts.validTo} IS NULL`,
      ),
    )
    .for('update')
  return (fact as ActiveLotteryFact | undefined) ?? null
}

async function countRosterEntries(
  tx: DbLike,
  rosterId: number,
  grade: LotteryGrade,
  acceptedOnly: boolean,
): Promise<number> {
  const predicates = [
    eq(tournamentEntryRosterEntries.rosterId, rosterId),
    eq(tournamentEntryRosterEntries.grade, grade),
  ]
  if (acceptedOnly) {
    predicates.push(eq(tournamentEntryRosterEntries.selectionOutcome, 'accepted'))
  }
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentEntryRosterEntries)
    .where(and(...predicates))
  return row?.count ?? 0
}

async function countUnknownOutcomes(
  tx: DbLike,
  rosterId: number,
  grade: LotteryGrade,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentEntryRosterEntries)
    .where(
      and(
        eq(tournamentEntryRosterEntries.rosterId, rosterId),
        eq(tournamentEntryRosterEntries.grade, grade),
        eq(tournamentEntryRosterEntries.selectionOutcome, 'unknown'),
      ),
    )
  return row?.count ?? 0
}

async function validateFactSources(
  tx: DbLike,
  fact: {
    grade: LotteryGrade
    selectionStatus: LotterySelectionStatus
    capacity: number | null
    applicationStartDate: string | null
    applicantRosterId: number | null
    selectionResultRosterId: number | null
  },
) {
  if (fact.capacity != null && (!Number.isInteger(fact.capacity) || fact.capacity <= 0)) {
    throw new Error('級別定員は1以上の整数で入力してください')
  }
  if (fact.selectionStatus === 'no_capacity' && fact.capacity !== null) {
    throw new Error('定員なしでは級別定員を入力できません')
  }
  if (
    (fact.selectionStatus === 'lottery' || fact.selectionStatus === 'under_capacity') &&
    fact.capacity === null
  ) {
    throw new Error('抽選あり・定員未満には級別定員が必要です')
  }
  if (fact.grade === 'A' && fact.selectionStatus !== 'unknown' && !fact.applicationStartDate) {
    throw new Error('A級の公開判定には申込開始日が必要です')
  }
  if (
    fact.selectionStatus !== 'unknown' &&
    fact.applicantRosterId === null
  ) {
    throw new Error('公開判定には申込名簿原本が必要です')
  }
  if (fact.selectionStatus === 'lottery' && fact.selectionResultRosterId === null) {
    throw new Error('抽選ありには抽選結果原本が必要です')
  }
  if (fact.selectionStatus === 'under_capacity') {
    const applicantCount = await countRosterEntries(
      tx,
      fact.applicantRosterId!,
      fact.grade,
      false,
    )
    if (applicantCount <= 0 || applicantCount >= fact.capacity!) {
      throw new Error('定員未満は申込者数が1人以上かつ級別定員を下回る場合だけ選択できます')
    }
  }
  if (fact.selectionStatus === 'no_capacity') {
    const applicantCount = await countRosterEntries(
      tx,
      fact.applicantRosterId!,
      fact.grade,
      false,
    )
    if (applicantCount <= 0) throw new Error('定員なしには申込者が1人以上必要です')
  }
  if (fact.selectionStatus === 'lottery') {
    const applicantCount = await countRosterEntries(
      tx,
      fact.applicantRosterId!,
      fact.grade,
      false,
    )
    if (applicantCount <= 0) throw new Error('抽選ありには申込者が1人以上必要です')
    const acceptedCount = await countRosterEntries(
      tx,
      fact.selectionResultRosterId!,
      fact.grade,
      true,
    )
    if (acceptedCount === 0) {
      throw new Error('抽選結果原本に当選者がありません')
    }
    const unknownCount = await countUnknownOutcomes(
      tx,
      fact.selectionResultRosterId!,
      fact.grade,
    )
    if (unknownCount > 0) {
      throw new Error('抽選結果原本に当落不明の行があります')
    }
  }
}

/** Close an active fact and insert a full copied revision; never mutate adopted fields in place. */
export async function createLotteryFactRevision(
  tx: DbLike,
  input: {
    editionId: number
    config: GradeAdoptionConfig
    purpose: RosterPurpose
    rosterId: number
    correctionTargetRosterId: number | null
    sourceMailMessageId: number | null
    verifiedByUserId: string
  },
): Promise<number> {
  const current = await loadActiveLotteryFact(tx, input.editionId, input.config.grade)

  if (input.correctionTargetRosterId !== null) {
    const adoptedTarget =
      input.purpose === 'applicant'
        ? current?.applicantRosterId
        : input.purpose === 'selection_result'
          ? current?.selectionResultRosterId
          : input.correctionTargetRosterId
    if (adoptedTarget !== input.correctionTargetRosterId) {
      throw new Error(`${input.config.grade}級の訂正対象は現在採用中の原本ではありません`)
    }
  }

  const next = {
    editionId: input.editionId,
    grade: input.config.grade,
    selectionStatus: input.config.selectionStatus,
    capacity: input.config.capacity,
    applicationStartDate: input.config.applicationStartDate,
    applicantRosterId:
      input.purpose === 'applicant' ? input.rosterId : (current?.applicantRosterId ?? null),
    selectionResultRosterId:
      input.purpose === 'selection_result'
        ? input.rosterId
        : (current?.selectionResultRosterId ?? null),
    actualResultClassId: current?.actualResultClassId ?? null,
    selectionRuleVersion:
      current?.selectionRuleVersion ??
      (input.config.grade === 'A' && input.config.applicationStartDate
        ? 'ajka-a-priority-2024-v1'
        : null),
    sourceMailMessageId: input.sourceMailMessageId,
    verifiedAt: new Date(),
    verifiedByUserId: input.verifiedByUserId,
    supersedesFactId: current?.id ?? null,
  }

  await validateFactSources(tx, next)

  if (current) {
    await tx
      .update(tournamentEditionGradeLotteryFacts)
      .set({ validTo: new Date() })
      .where(
        and(
          eq(tournamentEditionGradeLotteryFacts.id, current.id),
          sql`${tournamentEditionGradeLotteryFacts.validTo} IS NULL`,
        ),
      )
  }
  const [inserted] = await tx
    .insert(tournamentEditionGradeLotteryFacts)
    .values(next)
    .returning({ id: tournamentEditionGradeLotteryFacts.id })
  if (!inserted) throw new Error('級別採用原本を保存できませんでした')
  return inserted.id
}

async function insertCopiedFactWithActualResult(
  tx: DbLike,
  current: ActiveLotteryFact,
  actualResultClassId: number,
  sourceMailMessageId: number | null,
  verifiedByUserId: string,
) {
  await tx
    .update(tournamentEditionGradeLotteryFacts)
    .set({ validTo: new Date() })
    .where(
      and(
        eq(tournamentEditionGradeLotteryFacts.id, current.id),
        sql`${tournamentEditionGradeLotteryFacts.validTo} IS NULL`,
      ),
    )
  await tx.insert(tournamentEditionGradeLotteryFacts).values({
    editionId: current.editionId,
    grade: current.grade,
    selectionStatus: current.selectionStatus,
    capacity: current.capacity,
    applicationStartDate: current.applicationStartDate,
    applicantRosterId: current.applicantRosterId,
    selectionResultRosterId: current.selectionResultRosterId,
    actualResultClassId,
    selectionRuleVersion: current.selectionRuleVersion,
    sourceMailMessageId: sourceMailMessageId ?? current.sourceMailMessageId,
    verifiedAt: new Date(),
    verifiedByUserId,
    supersedesFactId: current.id,
  })
}

export async function linkActualResultClass(
  tx: DbLike,
  input: {
    editionId: number
    grade: LotteryGrade
    classId: number
    sourceMailMessageId: number | null
    verifiedByUserId: string
    replaceExisting: boolean
  },
): Promise<'linked' | 'replaced' | 'unchanged' | 'skipped_existing'> {
  const current = await loadActiveLotteryFact(tx, input.editionId, input.grade)
  if (!current) {
    await tx.insert(tournamentEditionGradeLotteryFacts).values({
      editionId: input.editionId,
      grade: input.grade,
      selectionStatus: 'unknown',
      actualResultClassId: input.classId,
      sourceMailMessageId: input.sourceMailMessageId,
      verifiedAt: new Date(),
      verifiedByUserId: input.verifiedByUserId,
    })
    return 'linked'
  }
  if (current.actualResultClassId === input.classId) return 'unchanged'
  if (current.actualResultClassId !== null && !input.replaceExisting) return 'skipped_existing'

  await insertCopiedFactWithActualResult(
    tx,
    current,
    input.classId,
    input.sourceMailMessageId,
    input.verifiedByUserId,
  )
  return current.actualResultClassId === null ? 'linked' : 'replaced'
}
