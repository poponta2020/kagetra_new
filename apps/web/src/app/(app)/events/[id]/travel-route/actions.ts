'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import { isSchoolYearForKind } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import {
  normalizeRouteInput,
  travelRouteInputSchema,
  validateLegDates,
} from '@/lib/travel-report/routes'
import { saveTravelRoute } from '@/lib/travel-report/routes-store'
import { sendAllEnteredNotice } from '@/lib/travel-report/notify'
import {
  isRouteInputOpen,
  loadGroupTravelContext,
  loadTravelUnitStatus,
} from '@/lib/travel-report/targets'
import { findUnitContainingEvent } from '@/lib/travel-report/units'

/**
 * travel-report S8: 経路の保存（requirements R5・R6・R8）。
 *
 * ★このページの表示条件（開いているか・対象者か・代理入力の権限）を
 * **一切信頼しない**。`page.tsx` が通したことを前提にせず、ここで独立に
 * 全チェックをやり直す（fail-closed。auth 越境・URL 直叩き・古い画面から
 * の再送に耐える）。
 *
 * `unitStartDate` はクライアントから受け取らず、送られてきた `eventId` から
 * `findUnitContainingEvent` で都度導出する——単位のキーをクライアントに
 * 信頼させない分、page.tsx より一段安全になっている。
 */

export type SaveTravelRouteState = {
  error?: string
  success?: boolean
}

const PHONE_RE = /^[0-9-]+$/

function strOf(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

export async function saveTravelRouteAction(
  _prev: SaveTravelRouteState,
  formData: FormData,
): Promise<SaveTravelRouteState> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'ログインが必要です' }

  const eventId = Number(strOf(formData.get('eventId')))
  const entryGroupId = Number(strOf(formData.get('entryGroupId')))
  const targetUserId = strOf(formData.get('targetUserId')).trim()
  if (
    !Number.isInteger(eventId) ||
    eventId <= 0 ||
    !Number.isInteger(entryGroupId) ||
    entryGroupId <= 0 ||
    targetUserId.length === 0
  ) {
    return { error: '入力が不正です' }
  }

  const eventRow = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true, title: true, entryGroupId: true },
  })
  if (!eventRow || eventRow.entryGroupId !== entryGroupId) {
    return { error: '対象の大会が見つかりません' }
  }

  const ctx = await loadGroupTravelContext(entryGroupId)
  const unit = findUnitContainingEvent(ctx.units, eventId)
  if (!unit) return { error: '遠征単位が見つかりません' }

  const rosterState = await loadConfirmedRosterState(entryGroupId)
  if (!isRouteInputOpen(ctx, rosterState.settled)) {
    return { error: '経路入力はまだ開始されていません' }
  }

  if (targetUserId !== session.user.id) {
    const canProxy = await isTravelReportSubmitter(session)
    if (!canProxy) return { error: '他の人の経路を保存する権限がありません' }
  }

  const status = await loadTravelUnitStatus(entryGroupId, ctx.units, unit.startDate)
  if (!status) return { error: '遠征単位が見つかりません' }
  const target = status.targets.find((t) => t.userId === targetUserId)
  if (!target) return { error: '対象者ではありません' }

  const legsRaw = strOf(formData.get('legs'))
  let legsParsed: unknown
  try {
    legsParsed = legsRaw.length > 0 ? JSON.parse(legsRaw) : []
  } catch {
    return { error: '移動行の形式が不正です' }
  }

  const parsed = travelRouteInputSchema.safeParse({
    departureKind: strOf(formData.get('departureKind')),
    departurePlace: strOf(formData.get('departurePlace')) || null,
    returnKind: strOf(formData.get('returnKind')),
    returnPlace: strOf(formData.get('returnPlace')) || null,
    legs: legsParsed,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  const dateError = validateLegDates(parsed.data.legs, unit)
  if (dateError) return { error: dateError }

  const normalized = normalizeRouteInput(parsed.data)

  // プロフィールの書き戻し（欠けていた項目・「修正」からの更新の両方）。
  // クライアントは4項目をまとめて出し入れするので、`faculty` の有無を
  // 「プロフィール欄が開かれて送信された」の目印にする（all-or-nothing）。
  let profile:
    | { facultyKind: FacultyKind; faculty: string; schoolYear: string; phone: string }
    | undefined
  if (formData.has('faculty')) {
    const facultyKindRaw = strOf(formData.get('facultyKind')).trim()
    if (facultyKindRaw !== 'undergraduate' && facultyKindRaw !== 'graduate') {
      return { error: '所属（学部／大学院）を選択してください' }
    }
    const facultyKind: FacultyKind = facultyKindRaw

    const faculty = strOf(formData.get('faculty')).trim()
    if (faculty.length === 0) return { error: '学部等名を入力してください' }
    if (faculty.length > 50) return { error: '学部等名は50文字以内で入力してください' }

    const schoolYear = strOf(formData.get('schoolYear')).trim()
    if (schoolYear.length === 0 || !isSchoolYearForKind(schoolYear, facultyKind)) {
      return { error: '学年を選択してください' }
    }

    const phone = strOf(formData.get('phone')).trim()
    if (!PHONE_RE.test(phone)) {
      return { error: '電話番号は数字とハイフンで入力してください' }
    }
    const digits = phone.replace(/-/g, '')
    if (digits.length < 10 || digits.length > 13) {
      return { error: '電話番号の桁数が不正です（10〜13桁）' }
    }

    profile = { facultyKind, faculty, schoolYear, phone }
  }

  const result = await saveTravelRoute({
    entryGroupId,
    unit,
    targetUserId,
    actorUserId: session.user.id,
    targets: status.targets,
    route: normalized,
    profile,
  })

  // R8: 全員そろった通知は tx コミット後（saveTravelRoute はコミット済みで返る）。
  if (result.shouldNotify) {
    await sendAllEnteredNotice({
      entryGroupId,
      unitStartDate: unit.startDate,
      memberCount: result.memberCount,
      tournamentName: eventRow.title,
    })
  }

  revalidatePath(`/events/${eventId}`)
  revalidatePath('/dashboard')
  revalidatePath(`/admin/entries/${entryGroupId}`)

  return { success: true }
}
