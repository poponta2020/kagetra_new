'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  eventBroadcastMessages,
  events,
  eventAttendances,
  eventLineBroadcasts,
  lineChannels,
  users,
} from '@kagetra/shared/schema'
import {
  generateInviteCode,
  inviteCodeExpiresAt,
} from '@/lib/invite-code'
import { broadcastMailToEvent } from '@/lib/line-broadcast'

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export interface GeneratedInviteCode {
  inviteCode: string
  expiresAt: Date
  botId: string
  botLabel: string
  addFriendUrl: string
}

/**
 * Reserve a `event_broadcast` channel from the pool and issue a fresh
 * 6-digit invite code for this event.
 *
 * Idempotency:
 *   - If the event already has an active broadcast row (status invite_pending
 *     / joined_waiting_code / linked), the existing row is updated in place
 *     so we never break the 1-event-1-binding UNIQUE constraint.
 *   - If the event has no active row but reserved a channel previously that
 *     is now expired, the same row is recycled (code overwritten, expiry
 *     bumped). The channel keeps its `assigned` status.
 *
 * Failure modes surfaced to the operator:
 *   - "Bot プールが枯渇しています" when no `available` channel is left and
 *     the event has not already reserved one.
 *   - "現在 LINE 配信中の大会です" when an active `linked` row exists —
 *     a new code would tear down the live binding silently.
 */
export async function generateInviteCodeForEvent(
  eventId: number,
): Promise<GeneratedInviteCode> {
  await requireAdminSession()

  return await db.transaction(async (tx) => {
    const targetEvent = await tx.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true },
    })
    if (!targetEvent) throw new Error('大会が見つかりません')

    const existing = await tx.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.eventId, eventId),
    })

    if (existing && existing.status === 'linked') {
      throw new Error(
        '現在 LINE 配信中の大会です。解放してから再発行してください',
      )
    }

    let channelId: number
    if (existing) {
      channelId = existing.lineChannelId
      // existing が available に戻っているケース (release 直後の再発行) を
      // assigned に昇格。同じトランザクション内なので race は無い。
      await tx
        .update(lineChannels)
        .set({
          status: 'assigned',
          assignedEventId: eventId,
          updatedAt: sql`now()`,
        })
        .where(eq(lineChannels.id, channelId))
    } else {
      // Atomic reservation: SELECT で候補一覧を取り、UPDATE WHERE
      // status='available' RETURNING で奪い合う。並行 generateInviteCode
      // が同じ Bot を取り合った場合、敗者は RETURNING に行が出ないので
      // 次の候補に進む。partial unique を増やすより、status を排他資源
      // として使う方が既存制約 (assignedEventId UNIQUE) と整合する。
      const candidates = await tx
        .select({ id: lineChannels.id })
        .from(lineChannels)
        .where(
          and(
            eq(lineChannels.purpose, 'event_broadcast'),
            eq(lineChannels.status, 'available'),
          ),
        )
        .orderBy(asc(lineChannels.id))

      let reservedId: number | null = null
      for (const cand of candidates) {
        const reserved = await tx
          .update(lineChannels)
          .set({
            status: 'assigned',
            assignedEventId: eventId,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(lineChannels.id, cand.id),
              eq(lineChannels.status, 'available'),
            ),
          )
          .returning({ id: lineChannels.id })
        if (reserved[0]) {
          reservedId = reserved[0].id
          break
        }
      }
      if (reservedId == null) {
        throw new Error(
          'Bot プールが枯渇しています。/admin/line-channels で過去の Bot を解放してください',
        )
      }
      channelId = reservedId
    }

    const inviteCode = generateInviteCode()
    const expiresAt = inviteCodeExpiresAt()

    if (existing) {
      await tx
        .update(eventLineBroadcasts)
        .set({
          lineChannelId: channelId,
          inviteCode,
          inviteCodeExpiresAt: expiresAt,
          status: 'invite_pending',
          lineGroupId: null,
          linkedAt: null,
          releasedAt: null,
          revokedAt: null,
          revokeReason: null,
          updatedAt: sql`now()`,
        })
        .where(eq(eventLineBroadcasts.id, existing.id))
    } else {
      await tx.insert(eventLineBroadcasts).values({
        eventId,
        lineChannelId: channelId,
        inviteCode,
        inviteCodeExpiresAt: expiresAt,
        status: 'invite_pending',
      })
    }

    const channelRow = await tx.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
      columns: { botId: true, note: true },
    })
    if (!channelRow) throw new Error('チャネル情報の取得に失敗しました')

    revalidatePath(`/events/${eventId}`)
    revalidatePath('/admin/line-channels')

    return {
      inviteCode,
      expiresAt,
      botId: channelRow.botId,
      botLabel: channelRow.note ?? channelRow.botId,
      // botId is the LINE basic ID (`@...`). The friends-add URL accepts it
      // verbatim per the LINE Messaging API docs.
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(channelRow.botId)}`,
    }
  })
}

/**
 * Tear down the LINE binding for an event without issuing a new code.
 * Mirrors `releaseChannel` in admin/line-channels/actions.ts but is keyed
 * by event rather than channel — the events screen doesn't know the
 * channel id offhand.
 */
export async function revokeBroadcast(eventId: number): Promise<void> {
  await requireAdminSession()

  await db.transaction(async (tx) => {
    const current = await tx.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.eventId, eventId),
      columns: { id: true, lineChannelId: true },
    })
    if (!current) return

    await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: 'manual',
        // invite_code を残すと partial unique が次回発行を塞ぐ
        // (review r1 should_fix)。release / revoke 全パスで null 化する。
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(eventLineBroadcasts.id, current.id))

    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEventId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(lineChannels.id, current.lineChannelId))
  })

  revalidatePath(`/events/${eventId}`)
  revalidatePath('/admin/line-channels')
}

/**
 * Override the auto-release date for a live binding. Used when the
 * post-tournament打ち上げ chatter is expected to run past the default
 * 30-day grace window.
 */
export async function extendBroadcastLifetime(
  eventId: number,
  newUntil: string,
): Promise<void> {
  await requireAdminSession()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newUntil)) {
    throw new Error('日付の形式が不正です (YYYY-MM-DD)')
  }

  await db
    .update(eventLineBroadcasts)
    .set({ extendedUntil: newUntil, updatedAt: sql`now()` })
    .where(eq(eventLineBroadcasts.eventId, eventId))

  revalidatePath(`/events/${eventId}`)
}

/**
 * Re-broadcast a specific mail to the LINE group bound to this event.
 *
 * Use cases:
 *   - The original auto-broadcast failed (event_broadcast_messages.status
 *     = 'failed') and the operator wants to retry after fixing the cause.
 *   - The operator wants to re-send a mail (e.g. the LINE group was
 *     re-bound after the original send).
 *
 * Idempotent: line-broadcast.ts upserts the existing audit row, so the
 * UNIQUE constraint on (event_line_broadcast_id, mail_message_id) is
 * preserved.
 */
export async function manualBroadcast(
  eventId: number,
  mailMessageId: number,
): Promise<void> {
  await requireAdminSession()

  // Look up the existing audit row (if any) to inherit the correction flag.
  // Manual rebroadcast should preserve whether the underlying mail was a
  // correction so the 【訂正】 prefix stays consistent across retries.
  const existing = await db
    .select({
      isCorrection: eventBroadcastMessages.isCorrection,
    })
    .from(eventBroadcastMessages)
    .innerJoin(
      eventLineBroadcasts,
      eq(eventLineBroadcasts.id, eventBroadcastMessages.eventLineBroadcastId),
    )
    .where(
      and(
        eq(eventLineBroadcasts.eventId, eventId),
        eq(eventBroadcastMessages.mailMessageId, mailMessageId),
      ),
    )
    .limit(1)

  await broadcastMailToEvent(db, {
    eventId,
    mailMessageId,
    isCorrection: existing[0]?.isCorrection ?? false,
  })

  revalidatePath(`/events/${eventId}`)
}

export async function submitAttendance(eventId: number, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const isAdminUser =
    session.user.role === 'admin' || session.user.role === 'vice_admin'

  const attend = formData.get('attend') === 'true'
  // Comment is only updated when the form actually submits a `comment` field.
  // The sticky single-toggle UI intentionally omits it, so we must not overwrite
  // any existing comment with null on a toggle — read conditionally.
  const commentRaw = formData.get('comment')
  const hasComment = commentRaw !== null
  const comment = hasComment ? ((commentRaw as string) || null) : null

  const [targetEvent, currentUser] = await Promise.all([
    db.query.events.findFirst({ where: eq(events.id, eventId) }),
    db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
  ])
  if (!targetEvent) throw new Error('Event not found')

  const todayJst = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })
  if (!isAdminUser && !currentUser?.isInvited) {
    throw new Error('出欠回答の対象外です')
  }
  if (
    !isAdminUser &&
    targetEvent.internalDeadline &&
    targetEvent.internalDeadline < todayJst
  ) {
    throw new Error('会内締切を過ぎています')
  }
  if (
    !isAdminUser &&
    targetEvent.eligibleGrades?.length &&
    (!currentUser?.grade ||
      !targetEvent.eligibleGrades.includes(currentUser.grade))
  ) {
    throw new Error('対象外の級です')
  }

  const updateSet: { attend: boolean; updatedAt: Date; comment?: string | null } =
    { attend, updatedAt: new Date() }
  if (hasComment) updateSet.comment = comment

  await db
    .insert(eventAttendances)
    .values({ eventId, userId: session.user.id, attend, comment })
    .onConflictDoUpdate({
      target: [eventAttendances.eventId, eventAttendances.userId],
      set: updateSet,
    })

  revalidatePath(`/events/${eventId}`)
}
