'use server'

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { entryGroups, entryGroupSelectionStatuses } from '@kagetra/shared/schema'
import type { TravelSelectionStatus } from '@kagetra/shared'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { loadSelectionStatusRows } from '@/lib/travel-report/selection-status'

/**
 * 遠征届（travel-report）まわりの Server Action をまとめるファイル。
 *
 * - タスク3（本ファイル初版）: `saveSelectionStatuses` / `resetSelectionStatuses`
 *   （S5 名簿セクションの「確定状況」。requirements R3・AC-8/AC-9）
 * - タスク6で `setRequired` / `startRouteInput` / `updateDestination`
 *   （S5 遠征届セクションの必要/不要・経路入力の開始・開催地修正）が追記される予定。
 *
 * 1関数専用の狭いモジュールにはしない——各関数は自分で認可ガードを呼ぶ素直な
 * 構成にする（`admin/entries/[groupId]/actions.ts` の既存流儀を踏襲）。
 */

/**
 * entry-group-page タスク2 と同じ理由でこのファイル内にも同じ実装を持つ
 * （`events/[id]/actions.ts` の `requireAdminSession` は export されていない）。
 * 確定状況の保存は**管理者・副管理者のみ**（requirements §3.2 R12。副連絡責任者は不可）。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

const STATUS_VALUES = ['confirmed', 'waitlisted', 'not_participating'] as const satisfies readonly TravelSelectionStatus[]

const saveSelectionStatusesSchema = z.object({
  updates: z
    .array(
      z.object({
        userId: z.string().min(1),
        status: z.enum(STATUS_VALUES),
      }),
    )
    .min(1, '保存する行がありません'),
})

export interface SelectionStatusUpdate {
  userId: string
  status: TravelSelectionStatus
}

async function requireExistingGroup(entryGroupId: number): Promise<void> {
  const [group] = await db
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, entryGroupId))
    .limit(1)
  if (!group) throw new Error('申込グループが見つかりません')
}

/**
 * S5 名簿セクション「確定状況」の一括保存（requirements R3・AC-8・AC-9）。
 *
 * `entry_group_selection_statuses` には**手入力だけ**を保存する（導出値を書かない
 * ——`selection-status.ts` のモジュール doc を参照）。
 *
 * 送られた `userId` は**その場で再計算した対象者集合**（当該グループのいずれかの
 * 日に出欠「参加」と答えた会員・ゲスト）に含まれるものだけを受け付ける。含まれない
 * `userId` が1件でもあれば何も保存せず拒否する（fail-closed。改ざんされた fetch
 * 経由の書き込みで対象外の会員が紛れ込むのを防ぐ）。
 */
export async function saveSelectionStatuses(
  entryGroupId: number,
  updates: SelectionStatusUpdate[],
): Promise<void> {
  const session = await requireAdminSession()

  const parsed = saveSelectionStatusesSchema.safeParse({ updates })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? '入力が不正です')
  }

  await requireExistingGroup(entryGroupId)

  const eligibleRows = await loadSelectionStatusRows(entryGroupId)
  const eligibleUserIds = new Set(eligibleRows.map((r) => r.userId))
  for (const update of parsed.data.updates) {
    if (!eligibleUserIds.has(update.userId)) {
      throw new Error('対象外の会員が含まれています')
    }
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    for (const update of parsed.data.updates) {
      await tx
        .insert(entryGroupSelectionStatuses)
        .values({
          entryGroupId,
          userId: update.userId,
          status: update.status,
          updatedAt: now,
          updatedBy: session.user.id,
        })
        .onConflictDoUpdate({
          target: [entryGroupSelectionStatuses.entryGroupId, entryGroupSelectionStatuses.userId],
          set: { status: update.status, updatedAt: now, updatedBy: session.user.id },
        })
    }
  })

  // フロー帯・ボードの区画（`hasConfirmedRoster`）は変わらないので、
  // `revalidateAfterLifecycleChange` は使わない（このグループページだけでよい）。
  revalidatePath(`/admin/entries/${entryGroupId}`)
}

/**
 * 「取込名簿の結果に戻す」（requirements R3）。手入力行を DELETE するだけで、
 * 導出値は書き込まない——以後は取込確定名簿からの導出（無ければ「確定」）に戻る。
 * 次の名簿再取込（繰上げ反映）もこの状態なら即座に効く。
 */
export async function resetSelectionStatuses(entryGroupId: number): Promise<void> {
  await requireAdminSession()
  await requireExistingGroup(entryGroupId)

  await db
    .delete(entryGroupSelectionStatuses)
    .where(eq(entryGroupSelectionStatuses.entryGroupId, entryGroupId))

  revalidatePath(`/admin/entries/${entryGroupId}`)
}
