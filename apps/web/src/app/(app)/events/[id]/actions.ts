'use server'

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  eventBroadcastGuidelineAttachments,
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
import { broadcastMailToEvent, loadActiveBinding } from '@/lib/line-broadcast'
import { sendGuidelinesOnLink } from '@/lib/line-broadcast-guidelines'
import {
  loadGuidelineCandidates,
  loadSelectedGuidelineAttachmentIds,
  type GuidelineCandidateMail,
} from '@/lib/event-related-mails'
import {
  buildLifecycleMessage,
  claimLifecycleNotification,
  sendClaimedNotification,
} from '@/lib/event-lifecycle-notify'
import { readExcel } from '@kagetra/mail-worker/result-import/reader'
import { parseRosterGrid } from '@/lib/roster-import/parser'
import { materializeRoster } from '@/lib/roster-import/materialize'

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
  // broadcast-guidelines-on-link: モーダルの「要綱として送信するファイル」選択
  // リスト用。候補は関連メール別（受信日時降順・添付 id 昇順）、選択済みは当該
  // LINE 連携行に保持済みの添付 id。
  guidelineCandidates: GuidelineCandidateMail[]
  selectedGuidelineAttachmentIds: number[]
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

  // 予約 (channel 確保 + invite code 発行) は 1 トランザクションで原子化する。
  // 一方で「要綱候補 (3 経路 union + 添付読取) / 選択済み添付 id」の読み取りは
  // この予約 tx の外 (commit 後) で行う——channel 予約 tx を無駄に肥大化させない
  // ため。
  const reservation = await db.transaction(async (tx) => {
    const targetEvent = await tx.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true },
    })
    if (!targetEvent) throw new Error('大会が見つかりません')

    // r-final-7 blocker: 以前は DB 全体の期限切れ inviteCode を null 化
    // していたが、他大会の invite_pending / joined_waiting_code 行に対して
    // status を維持したまま code だけを消すと、line_channels.status=
    // 'assigned' が固定化して日次 cron でも回収できなくなる (release-
    // expired-broadcasts.ts は `inviteCodeExpiresAt IS NOT NULL` を要求)。
    // 当面はここでの一括 null 化を廃止し、UNIQUE 衝突は下の MAX_ATTEMPTS=
    // 3 のリトライで吸収する (10^6 通り中数十の active コードと衝突する
    // 確率は実質ゼロ)。古い行の正規清掃は日次 release-expired ジョブに
    // 任せる (異常行回収パスも追加予定)。

    const existing = await tx.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.eventId, eventId),
    })

    if (existing && existing.status === 'linked') {
      throw new Error(
        '現在 LINE 配信中の大会です。解放してから再発行してください',
      )
    }

    // r2 review blocker: existing が revoked / released の場合、その
    // lineChannelId は別 event に再割り当てされている可能性がある。再利用
    // できるのは「同じ event に対して既に予約された Bot を取り戻す」場合
    // のみで、これは status が invite_pending / joined_waiting_code のとき
    // (= まだ Bot が他に流れていない状態) に限定する。
    const REUSABLE_STATUSES = new Set(['invite_pending', 'joined_waiting_code'])
    const canReuseExistingChannel =
      existing != null && REUSABLE_STATUSES.has(existing.status)

    /**
     * Atomic reservation loop: SELECT 候補 → UPDATE WHERE status='available'
     * RETURNING で奪い合う。並行 generateInviteCode が同じ Bot を取り合った
     * 場合、敗者は RETURNING に行が出ないので次の候補に進む。
     */
    async function reserveAvailableChannel(): Promise<number | null> {
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
        if (reserved[0]) return reserved[0].id
      }
      return null
    }

    let channelId: number
    if (canReuseExistingChannel) {
      // 同じ event に対して保留中の Bot を取り直す。既に assignedEventId=
      // eventId のはずだが、release レースで一旦 available に戻されていた
      // 可能性も含めて条件付き UPDATE で再 assign。失敗したら新規予約に
      // フォールバック (Bot が他 event に流れた場合)。
      const reclaimed = await tx
        .update(lineChannels)
        .set({
          status: 'assigned',
          assignedEventId: eventId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, existing!.lineChannelId),
            sql`(${lineChannels.assignedEventId} = ${eventId} OR ${lineChannels.status} = 'available')`,
          ),
        )
        .returning({ id: lineChannels.id })

      if (reclaimed[0]) {
        channelId = reclaimed[0].id
      } else {
        const reservedId = await reserveAvailableChannel()
        if (reservedId == null) {
          throw new Error(
            'Bot プールが枯渇しています。/admin/line-channels で過去の Bot を解放してください',
          )
        }
        channelId = reservedId
      }
    } else {
      // existing が無い、または revoked/released の場合は通常の新規予約。
      const reservedId = await reserveAvailableChannel()
      if (reservedId == null) {
        throw new Error(
          'Bot プールが枯渇しています。/admin/line-channels で過去の Bot を解放してください',
        )
      }
      channelId = reservedId
    }

    // r2 review should_fix: partial unique index に衝突した場合は新コードを
    // 生成して数回リトライ。10^6 通り中 ~30 個同時 active なら衝突確率
    // ~0.003% / 1 回。3 回リトライで実質ゼロ。
    // ネステッド `tx.transaction` で SAVEPOINT を切ることで、unique
    // violation 後の SQL ステートメントが ABORT 状態にならない。
    const MAX_ATTEMPTS = 3
    let inviteCode = ''
    let expiresAt = new Date()
    let lastError: unknown = null
    // 要綱選択の join のキー。UI へ返す候補/選択の読み取りに使う。
    let broadcastId: number | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      inviteCode = generateInviteCode()
      expiresAt = inviteCodeExpiresAt()
      try {
        await tx.transaction(async (sp) => {
          if (existing) {
            await sp
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
                // broadcast-guidelines-on-link: binding リセットに合わせて
                // 「要綱送信済み」監査もクリア。選択 (join 行) は同一行 UPDATE
                // なので保持され、再紐付け時に改めて送信される (AC-8)。
                guidelinesSentAt: null,
                updatedAt: sql`now()`,
              })
              .where(eq(eventLineBroadcasts.id, existing.id))
            broadcastId = existing.id
          } else {
            const insertedBroadcast = await sp
              .insert(eventLineBroadcasts)
              .values({
                eventId,
                lineChannelId: channelId,
                inviteCode,
                inviteCodeExpiresAt: expiresAt,
                status: 'invite_pending',
              })
              .returning({ id: eventLineBroadcasts.id })
            broadcastId = insertedBroadcast[0]!.id
          }
        })
        lastError = null
        break
      } catch (err) {
        lastError = err
        const code = (err as { code?: string }).code
        // PostgreSQL の unique_violation は SQLSTATE 23505。これ以外は
        // 即座に投げ直す (FK 違反等で再試行しても無駄)。
        if (code !== '23505') throw err
        if (attempt === MAX_ATTEMPTS) break
      }
    }
    if (lastError) {
      throw new Error(
        `招待コードの発行に失敗しました (UNIQUE 衝突を ${MAX_ATTEMPTS} 回連続で踏みました)`,
      )
    }

    const channelRow = await tx.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
      columns: { botId: true, note: true },
    })
    if (!channelRow) throw new Error('チャネル情報の取得に失敗しました')

    return {
      inviteCode,
      expiresAt,
      botId: channelRow.botId,
      botLabel: channelRow.note ?? channelRow.botId,
      // botId is the LINE basic ID (`@...`). The friends-add URL accepts it
      // verbatim per the LINE Messaging API docs.
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(channelRow.botId)}`,
      // broadcastId は必ず設定される (成功で break、全 attempt 失敗なら上で throw)。
      broadcastId: broadcastId!,
    }
  })

  // commit 後に候補と選択を読む (予約 tx に含めない)。
  const [guidelineCandidates, selectedGuidelineAttachmentIds] = await Promise.all([
    loadGuidelineCandidates(db, eventId),
    loadSelectedGuidelineAttachmentIds(db, reservation.broadcastId),
  ])

  revalidatePath(`/events/${eventId}`)
  revalidatePath('/admin/line-channels')

  return {
    inviteCode: reservation.inviteCode,
    expiresAt: reservation.expiresAt,
    botId: reservation.botId,
    botLabel: reservation.botLabel,
    addFriendUrl: reservation.addFriendUrl,
    guidelineCandidates,
    selectedGuidelineAttachmentIds,
  }
}

/**
 * broadcast-guidelines-on-link: 招待コードモーダルで選ばれた「要綱」添付を、
 * 当該イベントの LINE 連携行に保存する（replace 意味論・トグルで即時保存）。
 * admin / vice_admin のみ。
 *
 * `attachmentIds` は「今この大会で選択されている添付 id の全集合」。イベントの
 * 関連メール添付以外の id が混ざっていたら弾く（UI は候補 id しか送らないが防御）。
 * `event_line_broadcasts` は 1 大会 1 行なのでその行に紐づけて置き換える。招待
 * コード再発行は同一行 UPDATE なので、選択は再発行後も保持される（AC-2）。
 */
export async function setGuidelineAttachments(
  eventId: number,
  attachmentIds: number[],
): Promise<void> {
  await requireAdminSession()

  const broadcast = await db.query.eventLineBroadcasts.findFirst({
    where: eq(eventLineBroadcasts.eventId, eventId),
    columns: { id: true },
  })
  if (!broadcast) {
    throw new Error('先に招待コードを発行してください')
  }

  // 重複除去 + イベントの関連メール添付に限定（候補外 id は弾く）。
  const requested = Array.from(new Set(attachmentIds))
  if (requested.length > 0) {
    const candidates = await loadGuidelineCandidates(db, eventId)
    const validIds = new Set(
      candidates.flatMap((m) => m.attachments.map((a) => a.id)),
    )
    const invalid = requested.filter((id) => !validIds.has(id))
    if (invalid.length > 0) {
      throw new Error('この大会の関連メールに無い添付は選択できません')
    }
  }

  // replace 意味論: この連携行の既存選択を全消し → 要求分を入れ直す。件数は
  // 高々数件なので diff せず置換する。
  await db.transaction(async (tx) => {
    await tx
      .delete(eventBroadcastGuidelineAttachments)
      .where(
        eq(
          eventBroadcastGuidelineAttachments.eventLineBroadcastId,
          broadcast.id,
        ),
      )
    if (requested.length > 0) {
      await tx.insert(eventBroadcastGuidelineAttachments).values(
        requested.map((mailAttachmentId) => ({
          eventLineBroadcastId: broadcast.id,
          mailAttachmentId,
        })),
      )
    }
  })

  revalidatePath(`/events/${eventId}`)
}

/**
 * broadcast-guidelines-on-link: linked 状態で選択済み要綱を再送する（best-effort
 * の取りこぼし復旧）。admin / vice_admin のみ。linked していない / 選択が空 /
 * 送信失敗のときはエラーで返して UI に表示させる。
 */
export async function resendGuidelines(eventId: number): Promise<void> {
  await requireAdminSession()

  const binding = await loadActiveBinding(db, eventId)
  if (!binding) {
    throw new Error('LINE 連携が完了していません')
  }

  const result = await sendGuidelinesOnLink(db, {
    eventLineBroadcastId: binding.id,
    lineGroupId: binding.lineGroupId,
    channelAccessToken: binding.channel.channelAccessToken,
  })

  revalidatePath(`/events/${eventId}`)

  if (result.status === 'skipped') {
    throw new Error('送信できる要綱ファイルがありません')
  }
  if (result.status === 'failed' || result.status === 'partial') {
    throw new Error('要綱の送信に失敗しました。時間をおいて再度お試しください')
  }
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
    // rr1 review blocker: 古い released/revoked な行を引き当てると、
    // その lineChannelId は既に別 event に再割当済みの可能性がある。
    // active 系 (invite_pending / joined_waiting_code / linked) に限定。
    const current = await tx.query.eventLineBroadcasts.findFirst({
      where: and(
        eq(eventLineBroadcasts.eventId, eventId),
        sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
      ),
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

    // rr1 review blocker: 解放対象の channel は「現在この event に紐付いた
    // 行」だけに限定。`assignedEventId === eventId` を WHERE に含めると、
    // stale な action 呼び出しで他 event の channel を奪わない。
    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEventId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(lineChannels.id, current.lineChannelId),
          eq(lineChannels.assignedEventId, eventId),
        ),
      )
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

  // Look up the existing audit row (if any) to inherit the correction flag
  // and the saved lead heading. Manual rebroadcast should preserve whether
  // the underlying mail was a correction (so the 【訂正】 prefix stays
  // consistent) and re-send the original 冒頭メッセージ verbatim.
  const existing = await db
    .select({
      isCorrection: eventBroadcastMessages.isCorrection,
      leadText: eventBroadcastMessages.leadText,
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
    // 保存済み冒頭メッセージを継承して再送する (isCorrection 継承と同じパターン)。
    leadText: existing[0]?.leadText ?? null,
    // r-final-3 should_fix: manualBroadcast は UI からの「再配信」操作な
    // ので、status='sent' でも skip せず強制送信する。自動配信ループ
    // (approveDraft / linkDraftToEvent) では force を立てないため、
    // 二重送信は起きない。
    force: true,
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

// ---------------------------------------------------------------------------
// event-lifecycle-notify: 進行管理（申込/支払い状態のトグル + 完了通知）
//
// 完了通知は「未申込→申込済」「未払→支払済」の初回遷移のみ（once-ever）。
// 状態更新とログ claim を同一 tx で原子化し、コミット後に push する。push 失敗
// や LINE 未紐付けは状態変更を巻き戻さない（best-effort、要件 §3.2.3）。
// ---------------------------------------------------------------------------

/**
 * 申込状態をトグルする（admin/vice_admin のみ）。`applied=true` の初回遷移時
 * だけ完了通知を 1 回送る。`applied=false` は誤操作の戻し用で通知しない。
 */
export async function setEntryApplied(
  eventId: number,
  applied: boolean,
): Promise<void> {
  await requireAdminSession()

  if (!applied) {
    await db
      .update(events)
      .set({ entryStatus: 'not_applied', entryAppliedAt: null, updatedAt: sql`now()` })
      .where(eq(events.id, eventId))
    revalidatePath(`/events/${eventId}`)
    return
  }

  // entry-notify-lottery-treasurer: 申込完了で 2 通送る（参加者向け＋会計向け）。
  // 両 claim は同一 tx で UNIQUE が判定するので、再トグルや並行呼び出しでも
  // それぞれ 1 回限り。コミット後の push は独立 try/catch (best-effort)。
  const result = await db.transaction(async (tx) => {
    // 未申込→申込済 の初回遷移だけ通す（ガード）。既に applied なら 0 件で
    // 通知しない。会計向け文面に必要なフィールド (lotteryDate / payment*) も
    // 同時に取り出す（コミット後の文面組立に使う）。
    const flipped = await tx
      .update(events)
      .set({ entryStatus: 'applied', entryAppliedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(events.id, eventId), eq(events.entryStatus, 'not_applied')))
      .returning({
        id: events.id,
        title: events.title,
        status: events.status,
        lotteryDate: events.lotteryDate,
        paymentDeadline: events.paymentDeadline,
        paymentMethod: events.paymentMethod,
        paymentInfo: events.paymentInfo,
      })
    const row = flipped[0]
    type PendingNotification = {
      participantNotificationId: number | null
      treasurerNotificationId: number | null
      title: string
      lotteryDate: string | null
      paymentDeadline: string | null
      paymentMethod: string | null
      paymentInfo: string | null
    }
    const empty: PendingNotification = {
      participantNotificationId: null,
      treasurerNotificationId: null,
      title: '',
      lotteryDate: null,
      paymentDeadline: null,
      paymentMethod: null,
      paymentInfo: null,
    }
    if (!row) return empty
    // cancelled 大会には 2 通とも通知しない（要件 §3.2.2 #2、既存 entry_applied と対称）。
    // 状態変更そのものは記録する（once-ever スロットは消費しない＝後で復帰しても通知しない方針は既存と一貫）。
    if (row.status === 'cancelled') return empty
    // 種別ごとに独立 claim（UNIQUE(event_id,type) で 2 回目以降は claim 失敗）。
    // 同一 tx 内で両方走らせるので、片方の claim 結果がもう片方を阻害することはない。
    const participantClaim = await claimLifecycleNotification(tx, eventId, 'entry_applied')
    const treasurerClaim = await claimLifecycleNotification(tx, eventId, 'entry_applied_treasurer')
    return {
      participantNotificationId: participantClaim.id ?? null,
      treasurerNotificationId: treasurerClaim.id ?? null,
      title: row.title,
      lotteryDate: row.lotteryDate,
      paymentDeadline: row.paymentDeadline,
      paymentMethod: row.paymentMethod,
      paymentInfo: row.paymentInfo,
    }
  })

  // 参加者向け（抽選日があれば追記）。
  if (result.participantNotificationId != null) {
    const message = buildLifecycleMessage('entry_applied', {
      title: result.title,
      lotteryDateIso: result.lotteryDate,
    })
    try {
      await sendClaimedNotification(db, {
        notificationId: result.participantNotificationId,
        eventId,
        message,
      })
    } catch {
      // best-effort: 状態変更はコミット済み。push 失敗で巻き戻さない。
    }
  }

  // 会計向け 2 通目（振込方法/期限/詳細、全空なら最小文面）。
  // 参加者向けの push 失敗ともう片方の送信成否は独立（要件 §3.2.5）。
  if (result.treasurerNotificationId != null) {
    const message = buildLifecycleMessage('entry_applied_treasurer', {
      title: result.title,
      paymentDeadlineIso: result.paymentDeadline,
      paymentMethod: result.paymentMethod,
      paymentInfo: result.paymentInfo,
    })
    try {
      await sendClaimedNotification(db, {
        notificationId: result.treasurerNotificationId,
        eventId,
        message,
      })
    } catch {
      // best-effort
    }
  }
  revalidatePath(`/events/${eventId}`)
}

/**
 * 支払いタイプを設定する（事前払い/現地払い/未設定）。通知は送らない。
 */
export async function setPaymentType(
  eventId: number,
  type: 'advance' | 'onsite' | null,
): Promise<void> {
  await requireAdminSession()

  // advance 以外へ変えるときは「advance のときだけ意味を持つ」支払状態
  // (paymentStatus/paymentPaidAt) を未払へ戻し、再び advance に戻したとき古い
  // 支払済表示が残らないようにする。
  //
  // ただし payment_paid の once-ever ログは **削除しない**（要件 §6.4: 完了通知は
  // 同一 (event,type) で永久に一度きり）。結果として、支払いタイプを往復して再度
  // 支払済にすると表示は支払済へ戻るが、UNIQUE(event_id,type) により LINE 完了通知は
  // 再送されない（参加者への重複通知を防ぐ）。完了通知をやり直したい運用は想定しない。
  const leavingAdvance = type !== 'advance'
  await db
    .update(events)
    .set({
      paymentType: type,
      ...(leavingAdvance ? { paymentStatus: 'unpaid', paymentPaidAt: null } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(events.id, eventId))
  revalidatePath(`/events/${eventId}`)
}

/**
 * 事前払いの支払状態をトグルする。`paid=true` の初回遷移時だけ完了通知を送る。
 * payment_type='advance' のときのみ有効（現地払い/未設定では行を更新しない）。
 */
export async function setPaymentPaid(
  eventId: number,
  paid: boolean,
): Promise<void> {
  await requireAdminSession()

  if (!paid) {
    await db
      .update(events)
      .set({ paymentStatus: 'unpaid', paymentPaidAt: null, updatedAt: sql`now()` })
      .where(and(eq(events.id, eventId), eq(events.paymentType, 'advance')))
    revalidatePath(`/events/${eventId}`)
    return
  }

  const result = await db.transaction(async (tx) => {
    const flipped = await tx
      .update(events)
      .set({ paymentStatus: 'paid', paymentPaidAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(events.id, eventId),
          eq(events.paymentType, 'advance'),
          eq(events.paymentStatus, 'unpaid'),
        ),
      )
      .returning({
        id: events.id,
        title: events.title,
        feeJpy: events.feeJpy,
        status: events.status,
      })
    if (!flipped[0]) {
      return { notificationId: null as number | null, title: '', feeJpy: null as number | null }
    }
    // cancelled 大会には通知しない（要件 §3.2.2 #2）。状態変更そのものは記録する。
    if (flipped[0].status === 'cancelled') {
      return { notificationId: null as number | null, title: '', feeJpy: null as number | null }
    }
    const claim = await claimLifecycleNotification(tx, eventId, 'payment_paid')
    return { notificationId: claim.id ?? null, title: flipped[0].title, feeJpy: flipped[0].feeJpy }
  })

  if (result.notificationId != null) {
    const message = buildLifecycleMessage('payment_paid', {
      title: result.title,
      feeJpy: result.feeJpy,
    })
    try {
      await sendClaimedNotification(db, {
        notificationId: result.notificationId,
        eventId,
        message,
      })
    } catch {
      // best-effort
    }
  }
  revalidatePath(`/events/${eventId}`)
}

/**
 * tournament-entry-rosters PR-3: 名簿（申込/確定）の Excel を取り込む。
 *
 * 管理者操作。ファイル→readExcel→parseRosterGrid→materializeRoster（置換・player/user 解決）を
 * 1 tx で。対象は個人戦のみ（§3.2）。パース不能・非対応ファイルはエラーで弾き DB を汚さない。
 * 名簿は外部事実なので出欠/entryStatus は自動更新しない（判断3）。
 */
export async function uploadRoster(
  eventId: number,
  formData: FormData,
): Promise<{ entryCount: number; matchedUserCount: number }> {
  await requireAdminSession()

  const rosterType = formData.get('rosterType')
  if (rosterType !== 'applicant' && rosterType !== 'confirmed') {
    throw new Error('入力が不正です: 名簿種別が不正です')
  }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('入力が不正です: ファイルを選択してください')
  }
  const publishedAtRaw = formData.get('publishedAt')
  const publishedAt =
    typeof publishedAtRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(publishedAtRaw)
      ? publishedAtRaw
      : null

  const target = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true, kind: true },
  })
  if (!target) throw new Error('イベントが見つかりません')
  if (target.kind !== 'individual') {
    throw new Error('名簿の取込は個人戦のみ対応しています')
  }

  const buf = Buffer.from(await file.arrayBuffer())
  let sheets
  try {
    sheets = await readExcel(buf, file.name)
  } catch {
    throw new Error('Excel の読み込みに失敗しました（.xlsx / .xls のみ対応）')
  }
  // parseRosterGrid は氏名列が無ければ throw（DB を汚さない）。
  const parsed = parseRosterGrid(sheets)

  const result = await db.transaction((tx) =>
    materializeRoster(tx, parsed, { eventId, rosterType, publishedAt }),
  )

  revalidatePath(`/events/${eventId}`)
  return { entryCount: result.entryCount, matchedUserCount: result.matchedUserCount }
}
