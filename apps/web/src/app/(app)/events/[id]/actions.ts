'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
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
import { broadcastEventsToGradeGroups } from '@/lib/event-grade-broadcast'
import { sendGuidelinesOnLink } from '@/lib/line-broadcast-guidelines'
import { listGroupSiblings, resolveEntryGroupId } from '@/lib/entry-groups'
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

/**
 * entry-groups タスク3 (AC-4): LINE 紐付けの変更操作はグループ内のどの日から
 * 行っても同一の紐付けに作用するので、`/events/${eventId}` だけを
 * revalidate すると、そのグループの他の日の詳細画面には古い LINE 状態が
 * 残ってしまう。グループ内の全イベントの詳細パスをまとめて revalidate する。
 */
async function revalidateGroupEventPaths(eventId: number): Promise<void> {
  const siblings = await listGroupSiblings(db, eventId)
  const ids = siblings.length > 0 ? siblings.map((s) => s.id) : [eventId]
  for (const id of ids) revalidatePath(`/events/${id}`)
}

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
    // entry-groups タスク3: 予約・紐付けの帰属先は entry_group_id。呼び出し
    // シグネチャは eventId のまま維持し、ここでグループへ解決する（AC-4:
    // グループ内のどの日から呼んでも同一の紐付けに作用する）。存在しない
    // eventId は resolveEntryGroupId が「大会が見つかりません」で投げる。
    const entryGroupId = await resolveEntryGroupId(tx, eventId)

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
      where: eq(eventLineBroadcasts.entryGroupId, entryGroupId),
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
            assignedEntryGroupId: entryGroupId,
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
      // 同じグループに対して保留中の Bot を取り直す。既に
      // assignedEntryGroupId=entryGroupId のはずだが、release レースで
      // 一旦 available に戻されていた可能性も含めて条件付き UPDATE で
      // 再 assign。失敗したら新規予約にフォールバック (Bot が他グループに
      // 流れた場合)。
      const reclaimed = await tx
        .update(lineChannels)
        .set({
          status: 'assigned',
          assignedEntryGroupId: entryGroupId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, existing!.lineChannelId),
            sql`(${lineChannels.assignedEntryGroupId} = ${entryGroupId} OR ${lineChannels.status} = 'available')`,
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
                entryGroupId,
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

  await revalidateGroupEventPaths(eventId)
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

  // 重複除去 + イベントの関連メール添付に限定（候補外 id は弾く）。候補検証は
  // 読み取りのみで status 遷移と競合しないため、行ロックの外で先に済ませる。
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

  // 選択の置換は、紐付け遷移（webhook の招待コード照合 / 手動紐付け）とのレースで
  // 「実際に送信した要綱」と「DB 上の選択」がズレないよう、event_line_broadcasts
  // 行を FOR UPDATE でロックし tx 内で status を再確認したうえで行う（mail-inbox の
  // draft 承認と同じ直列化パターン）。
  //   - webhook/手動が先に linked へ遷移 → 本 tx は linked を読んで abort（送信済み
  //     の古い選択のまま・DB も不変で整合）
  //   - 本 tx が先にロック → 置換を commit してからロック解放 → 続く linked 遷移後の
  //     送信は新しい選択を読む（整合）
  // 要件 Non-goals: linked 中の選択編集は不可（変更は連携解除→再発行）。
  await db.transaction(async (tx) => {
    // entry-groups タスク3: ロック対象行はグループ帰属で引く（AC-4）。
    const entryGroupId = await resolveEntryGroupId(tx, eventId)
    const locked = await tx
      .select({
        id: eventLineBroadcasts.id,
        status: eventLineBroadcasts.status,
      })
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.entryGroupId, entryGroupId))
      .for('update')
      .limit(1)
    const row = locked[0]
    if (!row) {
      throw new Error('先に招待コードを発行してください')
    }
    if (
      row.status !== 'invite_pending' &&
      row.status !== 'joined_waiting_code'
    ) {
      throw new Error(
        '紐付け完了後は要綱を変更できません。変更するには連携を解除して再発行してください',
      )
    }

    // replace 意味論: 既存選択を全消し → 要求分を入れ直す（件数は高々数件）。
    await tx
      .delete(eventBroadcastGuidelineAttachments)
      .where(
        eq(eventBroadcastGuidelineAttachments.eventLineBroadcastId, row.id),
      )
    if (requested.length > 0) {
      await tx.insert(eventBroadcastGuidelineAttachments).values(
        requested.map((mailAttachmentId) => ({
          eventLineBroadcastId: row.id,
          mailAttachmentId,
        })),
      )
    }
  })

  await revalidateGroupEventPaths(eventId)
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

  await revalidateGroupEventPaths(eventId)

  if (result.status === 'skipped') {
    throw new Error('送信できる要綱ファイルがありません')
  }
  if (result.status === 'failed' || result.status === 'partial') {
    throw new Error('要綱の送信に失敗しました。時間をおいて再度お試しください')
  }
}

/**
 * event-grade-group-broadcast: 級別グループへの再送（AC-21）。
 *
 * 「まだ送信済みでない級にだけ送る」はコアロジックの claim がそのまま担う
 * （`event_grade_broadcasts` に `sent_at` 付きの行がある級は claim が 0 件を返し、
 * 文面にも含まれない）。ここで送信済み級を自前で除外しない — 二重に判定すると
 * claim との間にレースが生まれる。
 *
 * 権限は **admin のみ**（AC-22）。このファイルの `requireAdminSession` は
 * vice_admin も通すため使わない。
 *
 * 配信は best-effort（`broadcastEventsToGradeGroups` は throw しない）なので、
 * 1件も送れなかったときだけ操作者へエラーを返して状況を伝える。
 */
export async function resendGradeBroadcast(eventId: number): Promise<void> {
  const session = await auth()
  if (session?.user?.role !== 'admin') throw new Error('Forbidden')

  const result = await broadcastEventsToGradeGroups(db, [eventId])

  revalidatePath(`/events/${eventId}`)

  if (result.sentGrades.length > 0) return
  if (result.skippedGrades.length > 0 && result.failedGrades.length === 0) {
    throw new Error('紐付け済みの級グループがありません。/admin/line-grade-groups で紐付けてください')
  }
  if (result.failedGrades.length > 0) {
    throw new Error('級グループへの送信に失敗しました。時間をおいて再度お試しください')
  }
  // 対象級が全て送信済み = 送るものが無い。
  throw new Error('未送信の級がありません')
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
    // entry-groups タスク3: 帰属はグループなので、グループ内のどの日から
    // 呼んでも同一行に作用する（AC-4）。
    const entryGroupId = await resolveEntryGroupId(tx, eventId)

    // rr1 review blocker: 古い released/revoked な行を引き当てると、
    // その lineChannelId は既に別グループに再割当済みの可能性がある。
    // active 系 (invite_pending / joined_waiting_code / linked) に限定。
    const current = await tx.query.eventLineBroadcasts.findFirst({
      where: and(
        eq(eventLineBroadcasts.entryGroupId, entryGroupId),
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

    // rr1 review blocker: 解放対象の channel は「現在このグループに紐付いた
    // 行」だけに限定。`assignedEntryGroupId === entryGroupId` を WHERE に
    // 含めると、stale な action 呼び出しで他グループの channel を奪わない。
    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEntryGroupId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(lineChannels.id, current.lineChannelId),
          eq(lineChannels.assignedEntryGroupId, entryGroupId),
        ),
      )
  })

  await revalidateGroupEventPaths(eventId)
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

  const entryGroupId = await resolveEntryGroupId(db, eventId)
  await db
    .update(eventLineBroadcasts)
    .set({ extendedUntil: newUntil, updatedAt: sql`now()` })
    .where(eq(eventLineBroadcasts.entryGroupId, entryGroupId))

  await revalidateGroupEventPaths(eventId)
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

  // entry-groups タスク3: 監査行 (event_broadcast_messages) は
  // event_line_broadcasts.id (= グループの紐付け行) に紐づく。呼び出し
  // シグネチャは eventId のまま維持し、ここでグループへ解決する（AC-4）。
  const entryGroupId = await resolveEntryGroupId(db, eventId)

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
        eq(eventLineBroadcasts.entryGroupId, entryGroupId),
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

  await revalidateGroupEventPaths(eventId)
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
    // entry-overdue-alert: entry_status は /events 一覧の表示可否も左右する
    // ようになった（not_applying が除外条件）。この revert 分岐は
    // not_applying → not_applied の復帰も担うため、一覧側のキャッシュも
    // 更新しておかないと古い（非表示のままの）一覧が残る。
    revalidatePath('/events')
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
 * entry-overdue-alert: 「申込者がいないため今回は申し込まない」を記録する
 * （admin/vice_admin のみ）。`not_applied` / `applied` どちらからでも遷移可
 * （要件 §3.2.2 の状態遷移表）。通知 claim・push は一切行わない — 対外的な
 * アクションを伴わない内部判断のため（要件 §7-9）。
 *
 * ここから直接 `applied` へは戻さない（UI 側も用意しない）。復帰は
 * `setEntryApplied(id, false)` で `not_applied` を経由させ、既存の遷移ガード
 * `WHERE entry_status = 'not_applied'` を変更せずに済ませる。
 */
export async function setEntryNotApplying(eventId: number): Promise<void> {
  await requireAdminSession()

  await db
    .update(events)
    .set({ entryStatus: 'not_applying', entryAppliedAt: null, updatedAt: sql`now()` })
    .where(eq(events.id, eventId))

  revalidatePath(`/events/${eventId}`)
  // /events 一覧は entry_status='not_applying' を除外条件にしているため、
  // 一覧側のキャッシュも更新する。
  revalidatePath('/events')
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
