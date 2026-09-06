import 'server-only'
import { after } from 'next/server'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  entryGroupTravelSettings,
  events,
  travelReportBatches,
  travelReportDocuments,
  users,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared'
import { db } from '@/lib/db'
import { formatEventDate, formatDateTimeShort } from '@/lib/event-date'
import { surname } from '@/lib/surname'
import { estimateDestination } from './destination-ai'
import { isRouteInputOpen, loadGroupTravelContext, loadTravelUnitStatuses } from './targets'
import type {
  TravelDestinationView,
  TravelReportHistoryView,
  TravelUnitView,
} from '@/app/(app)/admin/entries/[groupId]/components/TravelReportSection'

/**
 * travel-report: S5「遠征届」セクションへ渡す表示データの組み立て（server-only）。
 *
 * ページ（`admin/entries/[groupId]/page.tsx`）を薄く保つためにここへ出す。
 * ★**提出権限者向けの値（顔ぶれ・履歴）は `canOperate` が true のときだけ組み立てる。**
 * false のとき配列に入れない＝RSC payload に載らない（電話番号入りの作成物へ
 * 近づけない。requirements §6）。
 */

export interface TravelReportSectionData {
  required: boolean
  routeInputOpen: boolean
  submitterNames: string[]
  destination: TravelDestinationView
  units: TravelUnitView[]
  history?: TravelReportHistoryView[]
}

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/** 「11/7(土)・11/8(日)」。 */
function unitDateLabel(dates: readonly string[]): string {
  return dates.map((d) => formatEventDate(d)).join('・')
}

export async function loadTravelReportSectionData(
  entryGroupId: number,
  hasConfirmedRoster: boolean,
  canOperate: boolean,
): Promise<TravelReportSectionData> {
  const ctx = await loadGroupTravelContext(entryGroupId)
  const routeInputOpen = isRouteInputOpen(ctx, hasConfirmedRoster)

  // ★自動で開いた（確定名簿あり）グループで開催地が未設定なら、AI 推定を1回だけ走らせる。
  // RSC のレンダー中に await せず、`destination_attempted_at` を claim にして
  // `after()`（レスポンス送出後）で実行する（多重呼び出し防止。requirements R7）。
  if (routeInputOpen && ctx.destinationSource === null && ctx.destinationAttemptedAt === null) {
    scheduleDestinationEstimate(entryGroupId)
  }

  const [unitStatuses, submitters, gradesByDate] = await Promise.all([
    loadTravelUnitStatuses(entryGroupId, ctx.units),
    db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.isTravelReportSubmitter, true), isNull(users.deactivatedAt)))
      .orderBy(asc(users.id)),
    loadGradesByDate(entryGroupId),
  ])

  const targetIds = [...new Set(unitStatuses.flatMap((u) => u.targets.map((t) => t.userId)))]
  const memberGrades = canOperate
    ? await loadMemberGrades(targetIds)
    : new Map<string, Grade | null>()

  const units: TravelUnitView[] = unitStatuses.map(({ unit, targets }) => {
    const grades = new Set<Grade>()
    for (const date of unit.dates) for (const g of gradesByDate.get(date) ?? []) grades.add(g)
    return {
      startDate: unit.startDate,
      dateLabel: unitDateLabel(unit.dates),
      grades: GRADE_ORDER.filter((g) => grades.has(g)),
      targetCount: targets.length,
      enteredCount: targets.filter((t) => t.entered).length,
      members: canOperate
        ? targets.map((t) => ({
            userId: t.userId,
            name: surname(t.name ?? ''),
            grade: memberGrades.get(t.userId) ?? null,
            isGuest: t.isGuest,
            entered: t.entered,
            // 代理入力のリンク先は、その単位の先頭の開催日。
            eventId: unit.eventIds[0] ?? 0,
          }))
        : undefined,
    }
  })

  return {
    required: ctx.required,
    routeInputOpen,
    submitterNames: submitters.flatMap((s) => (s.name ? [surname(s.name)] : [])),
    destination: {
      label: ctx.destinationLabel,
      prefecture: ctx.destinationPrefecture,
      city: ctx.destinationCity,
      source: ctx.destinationSource,
    },
    units,
    history: canOperate ? await loadHistory(entryGroupId) : undefined,
  }
}

/** 開催日 → その日の対象級。 */
async function loadGradesByDate(entryGroupId: number): Promise<Map<string, Grade[]>> {
  const rows = await db
    .select({ eventDate: events.eventDate, eligibleGrades: events.eligibleGrades })
    .from(events)
    .where(eq(events.entryGroupId, entryGroupId))
  const out = new Map<string, Grade[]>()
  for (const row of rows) {
    const list = out.get(row.eventDate) ?? []
    for (const g of row.eligibleGrades ?? []) if (!list.includes(g)) list.push(g)
    out.set(row.eventDate, list)
  }
  return out
}

/** 顔ぶれの級表示（提出権限者にだけ渡す）。対象者ぶんだけ引く。 */
async function loadMemberGrades(userIds: readonly string[]): Promise<Map<string, Grade | null>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, grade: users.grade })
    .from(users)
    .where(inArray(users.id, [...userIds]))
  return new Map(rows.map((u) => [u.id, u.grade]))
}

/** 作成履歴（新しい順）。 */
async function loadHistory(entryGroupId: number): Promise<TravelReportHistoryView[]> {
  const rows = await db
    .select({
      id: travelReportDocuments.id,
      filename: travelReportDocuments.filename,
      createdAt: travelReportBatches.createdAt,
      createdByName: users.name,
    })
    .from(travelReportDocuments)
    .innerJoin(travelReportBatches, eq(travelReportBatches.id, travelReportDocuments.batchId))
    .leftJoin(users, eq(users.id, travelReportBatches.createdBy))
    .where(eq(travelReportBatches.entryGroupId, entryGroupId))
    .orderBy(desc(travelReportBatches.createdAt), desc(travelReportDocuments.id))
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    createdAtLabel: formatDateTimeShort(r.createdAt),
    createdByName: r.createdByName ? surname(r.createdByName) : null,
  }))
}

/**
 * 開催地の AI 推定を `after()`（レスポンス送出後）で1回だけ走らせる。
 *
 * ★claim は `UPDATE … WHERE destination_attempted_at IS NULL` の**条件付き更新**。
 * 同じページを同時に開いた2人のうち1人だけが推定へ進む。書き込みは
 * `destination_source IS NULL` のときだけ（並行する手入力を潰さない）。
 */
function scheduleDestinationEstimate(entryGroupId: number): void {
  // ★`after()` はリクエストスコープの外（ページを直接レンダーする単体テスト等）で
  // 呼ぶと throw する。開催地の推定は**あくまで補助**で、失敗しても空欄のまま機能が
  // 続くのが仕様（R7）。ここで例外を外へ出すとページ全体が落ちるので握りつぶす。
  try {
    scheduleAfter(entryGroupId)
  } catch (err) {
    console.warn('[travel-report/section-view] 開催地の推定をスケジュールできませんでした', err)
  }
}

function scheduleAfter(entryGroupId: number): void {
  after(async () => {
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

    // 設定行がまだ無いグループは、ここで既定値の行を作って claim する。
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
      })
      .where(
        and(
          eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
          // 手入力が先に入っていたら上書きしない。
          isNull(entryGroupTravelSettings.destinationSource),
        ),
      )
  })
}
