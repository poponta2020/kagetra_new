'use server'

import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  entryGroups,
  entryGroupSelectionStatuses,
  entryGroupTravelSettings,
  events,
} from '@kagetra/shared/schema'
import type { TravelSelectionStatus } from '@kagetra/shared'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { loadSelectionStatusRows } from '@/lib/travel-report/selection-status'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { estimateDestination } from '@/lib/travel-report/destination-ai'

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

// ---------------------------------------------------------------------------
// タスク6: S5 遠征届セクション（必要/不要・経路入力の開始・開催地の修正）
//
// ★これらは**提出権限者**（admin ∪ vice_admin ∪ member+副連絡責任者フラグ）が実行できる。
//   上の確定状況（admin ∪ vice_admin のみ）とは境界が違う（requirements R12 の権限表）。
// ---------------------------------------------------------------------------

/** 提出権限者だけを通す（`lib/travel-report/authz.ts` が判定の正典）。 */
async function requireSubmitterSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (!(await isTravelReportSubmitter(session))) throw new Error('Forbidden')
  return session
}

/** 設定行が無ければ既定値で作る upsert（行の有無に意味を持たせない）。 */
async function upsertTravelSettings(
  entryGroupId: number,
  patch: Partial<typeof entryGroupTravelSettings.$inferInsert>,
  updatedBy: string,
): Promise<void> {
  const now = new Date()
  await db
    .insert(entryGroupTravelSettings)
    .values({ entryGroupId, ...patch, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: entryGroupTravelSettings.entryGroupId,
      set: { ...patch, updatedAt: now, updatedBy },
    })
}

function revalidateGroup(entryGroupId: number): void {
  revalidatePath(`/admin/entries/${entryGroupId}`)
  revalidatePath('/dashboard')
}

/**
 * 「この大会は遠征届が必要」トグル（requirements R4・AC-10・AC-21）。
 *
 * ★`false` にしても**入力済みの経路・作成物は消さない**。`true` に戻すとそのまま
 * 復活する（消してしまうと「間違えて不要にした」が復旧不能になる）。
 */
export async function setTravelReportRequired(
  entryGroupId: number,
  required: boolean,
): Promise<void> {
  const session = await requireSubmitterSession()
  await requireExistingGroup(entryGroupId)
  await upsertTravelSettings(entryGroupId, { required }, session.user.id!)
  revalidateGroup(entryGroupId)
}

/**
 * 「経路入力を開始」（requirements R5・R7・AC-11・AC-19）。
 *
 * 開始時に開催地が未設定なら AI 推定を**同期で**1回行う（このボタンは押した人が
 * 結果を見る操作なので、`after()` に逃がさない）。推定に失敗しても開始は成功する。
 */
export async function startTravelRouteInput(entryGroupId: number): Promise<void> {
  const session = await requireSubmitterSession()
  await requireExistingGroup(entryGroupId)

  const settings = await db.query.entryGroupTravelSettings.findFirst({
    where: eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
  })
  const patch: Partial<typeof entryGroupTravelSettings.$inferInsert> = {
    routeInputStartedAt: settings?.routeInputStartedAt ?? new Date(),
  }

  // 開催地が未設定で、まだ推定を試していないなら1回だけ推定する。
  const needsEstimate =
    settings?.destinationSource == null && settings?.destinationAttemptedAt == null
  if (needsEstimate) {
    patch.destinationAttemptedAt = new Date()
    const [event] = await db
      .select({
        title: events.title,
        formalName: events.formalName,
        location: events.location,
      })
      .from(events)
      .where(eq(events.entryGroupId, entryGroupId))
      .orderBy(asc(events.eventDate), asc(events.id))
      .limit(1)
    if (event) {
      const estimated = await estimateDestination({
        location: event.location,
        title: event.formalName ?? event.title,
      })
      if (estimated) {
        patch.destinationPrefecture = estimated.prefecture
        patch.destinationCity = estimated.city
        patch.destinationLabel = estimated.label
        patch.destinationSource = 'ai'
      }
    }
  }

  await upsertTravelSettings(entryGroupId, patch, session.user.id!)
  revalidateGroup(entryGroupId)
}

const destinationSchema = z.object({
  prefecture: z.string().trim().max(20).nullable(),
  city: z.string().trim().max(40).nullable(),
  label: z.string().trim().min(1, '経路表記名を入力してください').max(20),
})

/**
 * 開催地の手修正（requirements R7・AC-19・AC-21）。
 * 手で直したら `destination_source = 'manual'` になり、以後 AI 推定で上書きしない。
 */
export async function updateTravelDestination(
  entryGroupId: number,
  input: { prefecture: string | null; city: string | null; label: string },
): Promise<void> {
  const session = await requireSubmitterSession()
  await requireExistingGroup(entryGroupId)
  const parsed = destinationSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? '開催地の入力が不正です')
  }
  await upsertTravelSettings(
    entryGroupId,
    {
      destinationPrefecture: parsed.data.prefecture || null,
      destinationCity: parsed.data.city || null,
      destinationLabel: parsed.data.label,
      destinationSource: 'manual',
      // 手入力で確定したので、以後 AI 推定を走らせない。
      destinationAttemptedAt: new Date(),
    },
    session.user.id!,
  )
  revalidateGroup(entryGroupId)
}
