'use server'

import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tournamentClasses, tournaments } from '@kagetra/shared/schema'

/**
 * `mail-inbox/actions.ts` の同名関数と同じガード。あちらは非 export のため
 * ここで再定義する（このディレクトリの Server Action ファイルは各自でガードを
 * 持つ既存の流儀 — `open-chat-actions.ts` を参照）。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export type ImportedGradeSummary = {
  grade: 'A' | 'B' | 'C' | 'D' | 'E'
  classCount: number
  tournamentNames: string[]
}

/**
 * tournament-results 承認画面: edition 配下に既に取り込み済みの級を grade 単位で
 * 集計する read-only Server Action。「取込済み」バッジ＋既定チェック OFF の判定に
 * フォーム側から呼ばれる（edition select の値が変わるたびに呼び直される）。
 *
 * read-only でも認可ガードは必須（このディレクトリの他 Server Action と同様）。
 */
export async function getEditionImportedGrades(
  editionId: number,
): Promise<ImportedGradeSummary[]> {
  await requireAdminSession()

  if (!Number.isInteger(editionId) || editionId <= 0) return []

  const rows = await db
    .select({
      grade: tournamentClasses.grade,
      tournamentName: tournaments.name,
    })
    .from(tournamentClasses)
    .innerJoin(tournaments, eq(tournaments.id, tournamentClasses.tournamentId))
    .where(eq(tournaments.editionId, editionId))

  const byGrade = new Map<'A' | 'B' | 'C' | 'D' | 'E', { classCount: number; tournamentNames: Set<string> }>()
  for (const row of rows) {
    if (row.grade === null) continue
    const entry = byGrade.get(row.grade) ?? { classCount: 0, tournamentNames: new Set<string>() }
    entry.classCount += 1
    entry.tournamentNames.add(row.tournamentName)
    byGrade.set(row.grade, entry)
  }

  return (['A', 'B', 'C', 'D', 'E'] as const).flatMap((grade) => {
    const entry = byGrade.get(grade)
    if (!entry) return []
    return [{ grade, classCount: entry.classCount, tournamentNames: [...entry.tournamentNames] }]
  })
}
