import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { TravelLeg, TravelWayKind } from '@kagetra/shared'
import { entryGroups, travelRoutes, travelUnitNotices, users } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import type { TravelTarget } from './targets'
import type { TravelUnit } from './units'

/**
 * travel-report: 経路の読み書きと「全員そろった」の遷移判定（requirements R6・R8）。
 *
 * 純粋な組み立て規則（既定行・検証）は `routes.ts`（DB に触れない）にあり、ここは
 * DB とトランザクションだけを持つ。`entry-fee.ts`（pure）と `entry-fee-tally.ts`（DB）の
 * 分離と同じ流儀。
 */

export interface SavedTravelRoute {
  userId: string
  departureKind: TravelWayKind
  departurePlace: string | null
  returnKind: TravelWayKind
  returnPlace: string | null
  legs: TravelLeg[]
  savedAt: Date
  savedByUserId: string | null
}

/** 1人 × 1単位の保存済み経路。未保存なら `null`。 */
export async function loadTravelRoute(
  entryGroupId: number,
  unitStartDate: string,
  userId: string,
): Promise<SavedTravelRoute | null> {
  const row = await db.query.travelRoutes.findFirst({
    where: and(
      eq(travelRoutes.entryGroupId, entryGroupId),
      eq(travelRoutes.unitStartDate, unitStartDate),
      eq(travelRoutes.userId, userId),
    ),
  })
  if (!row) return null
  return {
    userId: row.userId,
    departureKind: row.departureKind,
    departurePlace: row.departurePlace,
    returnKind: row.returnKind,
    returnPlace: row.returnPlace,
    legs: row.legs,
    savedAt: row.savedAt,
    savedByUserId: row.savedByUserId,
  }
}

/** 1単位ぶんの全員の経路（遠征届の生成・S5 の表示用）。 */
export async function loadTravelRoutesForUnit(
  entryGroupId: number,
  unitStartDate: string,
): Promise<SavedTravelRoute[]> {
  const rows = await db
    .select()
    .from(travelRoutes)
    .where(
      and(
        eq(travelRoutes.entryGroupId, entryGroupId),
        eq(travelRoutes.unitStartDate, unitStartDate),
      ),
    )
  return rows.map((row) => ({
    userId: row.userId,
    departureKind: row.departureKind,
    departurePlace: row.departurePlace,
    returnKind: row.returnKind,
    returnPlace: row.returnPlace,
    legs: row.legs,
    savedAt: row.savedAt,
    savedByUserId: row.savedByUserId,
  }))
}

/** S8 で欠けていたプロフィール項目を埋めたときの書き戻し（R6）。 */
export interface ProfilePatch {
  facultyKind?: 'undergraduate' | 'graduate'
  faculty?: string
  schoolYear?: string
  phone?: string
}

export interface SaveTravelRouteInput {
  entryGroupId: number
  unit: TravelUnit
  /** 経路の持ち主（代理入力なら対象者）。 */
  targetUserId: string
  /** 実際に保存操作をした人。 */
  actorUserId: string
  /** この単位の対象者（呼び出し側が `loadTravelUnitStatus` で取得したもの）。 */
  targets: readonly TravelTarget[]
  route: {
    departureKind: TravelWayKind
    departurePlace: string | null
    returnKind: TravelWayKind
    returnPlace: string | null
    legs: TravelLeg[]
  }
  profile?: ProfilePatch
}

export interface SaveTravelRouteResult {
  /** 保存後、この単位の対象者が全員入力済みになったか。 */
  allEntered: boolean
  /**
   * 通知を送るべきか（＝`travel_unit_notices.last_attempted_at` を claim 済み）。
   * 呼び出し側は**コミット後に** `sendAllEnteredNotice` を呼ぶ。
   */
  shouldNotify: boolean
  /** 通知時に文面へ載せる対象者数。 */
  memberCount: number
}

/**
 * 経路を保存し、「全員そろった」の遷移を判定して通知を claim する（R6・R8・AC-18）。
 *
 * ★`entry_groups` の行を `SELECT … FOR UPDATE` でロックしてから判定する。
 * 設定行（`entry_group_travel_settings`）は**無いことがある**のでロック対象にできず、
 * 必ず存在するグループ行を掴む（`entry-groups.ts` の既存パターンと同じ）。
 *
 * 遷移の判定は「**保存前**の未入力の対象者集合 == {保存者}」。
 * - 既にそろっている状態での再保存では送らない（未入力集合が空なので一致しない）
 * - 対象者が増えて未完了に戻り、再びそろえば改めて一致するので再送される
 * - そのため「最後に通知した対象者集合」を持たずに AC-18 の3条件を満たせる
 *
 * ★自己回復: 直近の送信が失敗して `last_error` が残っているとき、保存後に全員入力済み
 * なら遷移でなくても再送する（再送ボタンは置かない）。
 *
 * **この関数は push しない。** LINE 送信は tx の外（コミット後）で行う。
 */
export async function saveTravelRoute(
  input: SaveTravelRouteInput,
): Promise<SaveTravelRouteResult> {
  const targetIds = input.targets.map((t) => t.userId)
  const now = new Date()

  return db.transaction(async (tx) => {
    // 同じグループへの同時保存を直列化する（通知の二重送信を防ぐ）。
    await tx
      .select({ id: entryGroups.id })
      .from(entryGroups)
      .where(eq(entryGroups.id, input.entryGroupId))
      .for('update')

    const enteredRows =
      targetIds.length === 0
        ? []
        : await tx
            .select({ userId: travelRoutes.userId })
            .from(travelRoutes)
            .where(
              and(
                eq(travelRoutes.entryGroupId, input.entryGroupId),
                eq(travelRoutes.unitStartDate, input.unit.startDate),
                inArray(travelRoutes.userId, targetIds),
              ),
            )
    const enteredBefore = new Set(enteredRows.map((r) => r.userId))
    const pendingBefore = targetIds.filter((id) => !enteredBefore.has(id))

    await tx
      .insert(travelRoutes)
      .values({
        entryGroupId: input.entryGroupId,
        unitStartDate: input.unit.startDate,
        userId: input.targetUserId,
        departureKind: input.route.departureKind,
        departurePlace: input.route.departurePlace,
        returnKind: input.route.returnKind,
        returnPlace: input.route.returnPlace,
        legs: input.route.legs,
        savedAt: now,
        savedByUserId: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: [travelRoutes.entryGroupId, travelRoutes.unitStartDate, travelRoutes.userId],
        set: {
          departureKind: input.route.departureKind,
          departurePlace: input.route.departurePlace,
          returnKind: input.route.returnKind,
          returnPlace: input.route.returnPlace,
          legs: input.route.legs,
          savedAt: now,
          savedByUserId: input.actorUserId,
        },
      })

    // S8 で埋めたプロフィール項目を書き戻す（代理入力なら**対象者**のプロフィール）。
    if (input.profile && Object.keys(input.profile).length > 0) {
      await tx
        .update(users)
        .set({ ...input.profile, updatedAt: now })
        .where(eq(users.id, input.targetUserId))
    }

    const pendingAfter = pendingBefore.filter((id) => id !== input.targetUserId)
    const allEntered = targetIds.length > 0 && pendingAfter.length === 0
    // 遷移＝保存前の未入力集合がちょうど {保存者}。
    const isTransition = pendingBefore.length === 1 && pendingBefore[0] === input.targetUserId

    const notice = await tx.query.travelUnitNotices.findFirst({
      where: and(
        eq(travelUnitNotices.entryGroupId, input.entryGroupId),
        eq(travelUnitNotices.unitStartDate, input.unit.startDate),
      ),
    })
    // 自己回復: 前回の送信が失敗していて、いま全員そろっているなら遷移でなくても送る。
    const shouldNotify = allEntered && (isTransition || notice?.lastError != null)

    if (shouldNotify) {
      // claim（tx 内で書く。push はコミット後）。
      await tx
        .insert(travelUnitNotices)
        .values({
          entryGroupId: input.entryGroupId,
          unitStartDate: input.unit.startDate,
          lastAttemptedAt: now,
          notifiedMemberCount: targetIds.length,
        })
        .onConflictDoUpdate({
          target: [travelUnitNotices.entryGroupId, travelUnitNotices.unitStartDate],
          set: { lastAttemptedAt: now, notifiedMemberCount: targetIds.length },
        })
    }

    return { allEntered, shouldNotify, memberCount: targetIds.length }
  })
}

export interface UnitNoticeState {
  lastAttemptedAt: Date | null
  allEnteredNotifiedAt: Date | null
  lastError: string | null
  notifiedMemberCount: number | null
}

/** S5 の表示用に、単位ごとの通知記録をまとめて引く。 */
export async function loadUnitNotices(
  entryGroupId: number,
): Promise<Map<string, UnitNoticeState>> {
  const rows = await db
    .select()
    .from(travelUnitNotices)
    .where(eq(travelUnitNotices.entryGroupId, entryGroupId))
  return new Map(
    rows.map((r) => [
      r.unitStartDate,
      {
        lastAttemptedAt: r.lastAttemptedAt,
        allEnteredNotifiedAt: r.allEnteredNotifiedAt,
        lastError: r.lastError,
        notifiedMemberCount: r.notifiedMemberCount,
      },
    ]),
  )
}
