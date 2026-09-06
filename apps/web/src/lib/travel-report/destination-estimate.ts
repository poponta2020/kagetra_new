import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { entryGroupTravelSettings, events } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { estimateDestination } from './destination-ai'

/**
 * travel-report: 開催地の AI 推定の claim（並行実行防止）と結果の書き戻し
 * （requirements R7・Codex R1 #4）。
 *
 * 「経路入力を開始」（同期・`travel-report-actions.ts`）と、確定名簿ありで自動的に
 * 開いたときの推定（`after()` 内・`section-view.ts`）の**両方から同じ実装を呼ぶ**。
 * 別々に書くと、片方が推定へ進んでいる間にもう片方が別に走って結果が競合しうる。
 *
 * - claim: `destination_attempted_at IS NULL` のときだけ now() を書く条件付き
 *   UPDATE。設定行が無ければ既定値の行を作って claim する。claim できなければ
 *   （他のリクエストが先に claim済み）何もしない
 * - 書き戻し: `destination_source IS NULL` のときだけ（並行する手入力を潰さない）
 */
export async function claimAndEstimateDestination(
  entryGroupId: number,
  updatedBy?: string,
): Promise<void> {
  const claimed = await db
    .update(entryGroupTravelSettings)
    .set({ destinationAttemptedAt: new Date() })
    .where(
      and(
        eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
        isNull(entryGroupTravelSettings.destinationAttemptedAt),
      ),
    )
    .returning({ entryGroupId: entryGroupTravelSettings.entryGroupId })

  if (claimed.length === 0) {
    const inserted = await db
      .insert(entryGroupTravelSettings)
      .values({ entryGroupId, destinationAttemptedAt: new Date() })
      .onConflictDoNothing()
      .returning({ entryGroupId: entryGroupTravelSettings.entryGroupId })
    if (inserted.length === 0) return // 他のリクエストが先に claim した
  }

  const [event] = await db
    .select({ title: events.title, formalName: events.formalName, location: events.location })
    .from(events)
    .where(eq(events.entryGroupId, entryGroupId))
    .orderBy(asc(events.eventDate), asc(events.id))
    .limit(1)
  if (!event) return

  const estimated = await estimateDestination({
    location: event.location,
    title: event.formalName ?? event.title,
  })
  if (!estimated) return

  await db
    .update(entryGroupTravelSettings)
    .set({
      destinationPrefecture: estimated.prefecture,
      destinationCity: estimated.city,
      destinationLabel: estimated.label,
      destinationSource: 'ai',
      updatedAt: new Date(),
      ...(updatedBy ? { updatedBy } : {}),
    })
    .where(
      and(
        eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
        // 手入力が先に入っていたら上書きしない。
        isNull(entryGroupTravelSettings.destinationSource),
      ),
    )
}
