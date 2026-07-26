'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  eventLineBroadcasts,
  lineChannels,
} from '@kagetra/shared/schema'
import { sendGuidelinesOnLink } from '@/lib/line-broadcast-guidelines'
import { listGroupSiblings, resolveEntryGroupId } from '@/lib/entry-groups'

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

/**
 * entry-groups タスク3 (AC-4): LINE 紐付けの変更操作はグループ内のどの日から
 * 行っても同一の紐付けに作用するので、`/events/${eventId}` だけを
 * revalidate するとグループの他の日に古い LINE 状態が残る。
 */
async function revalidateGroupEventPaths(eventId: number): Promise<void> {
  const siblings = await listGroupSiblings(db, eventId)
  const ids = siblings.length > 0 ? siblings.map((s) => s.id) : [eventId]
  for (const id of ids) revalidatePath(`/events/${id}`)
}

/**
 * Force-release a broadcast Bot back to the pool. Used both for the
 * `active` (linked) state — operator wants the Bot freed mid-tournament —
 * and the `assigned` state — invite code went stale before anyone joined.
 *
 * Always runs in a transaction so the channel and its broadcast row stay
 * consistent.
 *
 * r-final-4 blocker: stale な詳細画面操作で「別グループに再割当済みの
 * Bot」を誤って解放しないよう、操作者が見ていた紐付け先を
 * `expectedEntryGroupId` で渡し、現在の DB 状態と一致する場合のみ実行する。
 * UI 経由でない直接呼出 (旧 action パス) では省略してこれまで通りの
 * broad release が走る。
 *
 * ★トークンは **entry_group_id**（r2 review blocker）。以前は画面が見ていた
 * 代表イベントの id を渡していたが、付け替えで**イベント0件になったグループ**が
 * 紐付けを持って残る仕様（要件 §3.2.6）では代表イベントが存在せず、トークンが
 * null に落ちて競合検出のない broad release 経路へ入ってしまう。その状態で古い
 * フォームを送ると、同じ Bot が別グループへ再割当された後の**新しい紐付けを
 * revoke** し得た。帰属そのもの（グループ id）をトークンにすればイベント0件でも
 * 欠落しない。
 */
export async function releaseChannel(
  channelId: number,
  expectedEntryGroupId?: number | null,
): Promise<void> {
  await requireAdminSession()

  await db.transaction(async (tx) => {
    // Mark any active/joined-waiting broadcast for this channel as revoked.
    // We do NOT delete the row — the audit trail (linked_at, line_group_id)
    // stays for operator review. invite_code は null に戻して partial
    // unique index が後続発行を塞がないようにする (review r1 should_fix)。
    const broadcastWhere = expectedEntryGroupId != null
      ? and(
          eq(eventLineBroadcasts.lineChannelId, channelId),
          eq(eventLineBroadcasts.entryGroupId, expectedEntryGroupId),
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
        )
      : and(
          eq(eventLineBroadcasts.lineChannelId, channelId),
          // A channel can have many historical (revoked/released) broadcasts;
          // only the currently-active one matters here.
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
        )

    const revoked = await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: 'manual',
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(broadcastWhere)
      .returning({ id: eventLineBroadcasts.id })

    // expectedEntryGroupId が指定されていて該当 broadcast が存在しなかった
    // 場合は、画面の見ていた紐付けが既に変わっている。channel は触らず
    // 何もせずに終了する (操作は no-op 扱い、UI 側で再ロードを促す)。
    if (expectedEntryGroupId != null && revoked.length === 0) {
      return
    }

    const channelWhere = expectedEntryGroupId != null
      ? and(
          eq(lineChannels.id, channelId),
          eq(lineChannels.assignedEntryGroupId, expectedEntryGroupId),
        )
      : eq(lineChannels.id, channelId)

    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEntryGroupId: null,
        updatedAt: sql`now()`,
      })
      .where(channelWhere)
  })

  revalidatePath('/admin/line-channels')
  revalidatePath(`/admin/line-channels/${channelId}`)
}

/**
 * Take a Bot offline (LINE side disabled, credentials rotated, etc.).
 * Refuses to act on a Bot that is currently linked to a live event —
 * releaseChannel must be called first so the broadcast row is closed
 * cleanly.
 */
export async function disableChannel(channelId: number): Promise<void> {
  await requireAdminSession()

  const row = await db.query.lineChannels.findFirst({
    where: eq(lineChannels.id, channelId),
    columns: { status: true, assignedEntryGroupId: true },
  })
  if (!row) throw new Error('チャネルが見つかりません')
  if (row.assignedEntryGroupId != null || row.status === 'active') {
    throw new Error(
      '紐付け中のチャネルは無効化できません。先に解放してください',
    )
  }

  // r-final-10 blocker: 上の事前チェック後に generateInviteCodeForEvent /
  // manualLinkGroup が同じ channel を予約するレースを潰す。UPDATE WHERE
  // に「未割当 + status が active/disabled でない」条件を再掲し、
  // returning() が 0 件なら競合エラーで返す。
  const updated = await db
    .update(lineChannels)
    .set({ status: 'disabled', updatedAt: sql`now()` })
    .where(
      and(
        eq(lineChannels.id, channelId),
        sql`${lineChannels.assignedEntryGroupId} IS NULL`,
        sql`${lineChannels.status} NOT IN ('active','disabled')`,
      ),
    )
    .returning({ id: lineChannels.id })

  if (updated.length === 0) {
    throw new Error(
      'チャネル状態が変わっています。再度ご確認のうえやり直してください',
    )
  }

  revalidatePath('/admin/line-channels')
  revalidatePath(`/admin/line-channels/${channelId}`)
}

/**
 * Bring a disabled Bot back into the pool. No-op if the Bot is already
 * `available` — the UI button is only rendered for disabled rows but the
 * server action is defensive in case of a race with another tab.
 */
export async function enableChannel(channelId: number): Promise<void> {
  await requireAdminSession()

  await db
    .update(lineChannels)
    .set({ status: 'available', updatedAt: sql`now()` })
    .where(and(eq(lineChannels.id, channelId), eq(lineChannels.status, 'disabled')))

  revalidatePath('/admin/line-channels')
  revalidatePath(`/admin/line-channels/${channelId}`)
}

/**
 * Operator fallback for the case where the webhook never receives the
 * `join` / message event (e.g. webhook URL misconfigured, transient LINE
 * outage). Bypasses the invite-code flow and directly binds an event to
 * a channel + group ID supplied by the operator after manual inspection
 * of the LINE app.
 *
 * Behaviour:
 *   - Channel must be `event_broadcast` purpose and either `available` or
 *     `assigned` (i.e. not already serving another event).
 *   - Event must not already have a binding (UNIQUE event_id is enforced
 *     at the DB layer but we surface a friendlier error first).
 *   - Atomic: channel goes `active` + assigned_event_id set, broadcast row
 *     upserted with status='linked', linked_at=now, line_group_id=<input>.
 */
export async function manualLinkGroup(input: {
  channelId: number
  eventId: number
  lineGroupId: string
}): Promise<void> {
  await requireAdminSession()

  const trimmedGroupId = input.lineGroupId.trim()
  if (trimmedGroupId.length === 0) {
    throw new Error('LINE グループ ID を入力してください')
  }

  const linked = await db.transaction(async (tx) => {
    // entry-groups タスク3: 呼び出しシグネチャは eventId のまま維持し、
    // 内部でグループへ解決する（帰属は entry_group_id）。存在しない
    // eventId は resolveEntryGroupId が「大会が見つかりません」で投げる。
    const entryGroupId = await resolveEntryGroupId(tx, input.eventId)

    const channel = await tx.query.lineChannels.findFirst({
      where: eq(lineChannels.id, input.channelId),
      columns: {
        id: true,
        purpose: true,
        status: true,
        assignedEntryGroupId: true,
        // broadcast-guidelines-on-link: commit 後の要綱送信に使う。
        channelAccessToken: true,
      },
    })
    if (!channel) throw new Error('チャネルが見つかりません')
    if (channel.purpose !== 'event_broadcast') {
      throw new Error('このチャネルは大会配信用ではありません')
    }
    if (channel.status === 'disabled') {
      throw new Error('無効化されたチャネルは紐付けできません')
    }
    if (
      channel.assignedEntryGroupId != null &&
      channel.assignedEntryGroupId !== entryGroupId
    ) {
      throw new Error('別の大会に紐付け済みのチャネルです')
    }

    // Existing binding for this group? Upsert in place so the unique
    // (entry_group_id) constraint never fires. A live binding to a
    // *different* channel is treated as a conflict — the operator must
    // release the old channel first.
    const existingBroadcast = await tx.query.eventLineBroadcasts.findFirst({
      where: eq(eventLineBroadcasts.entryGroupId, entryGroupId),
      columns: { id: true, lineChannelId: true, status: true },
    })

    if (
      existingBroadcast &&
      existingBroadcast.lineChannelId !== input.channelId &&
      ['invite_pending', 'joined_waiting_code', 'linked'].includes(
        existingBroadcast.status,
      )
    ) {
      throw new Error(
        '同じ大会に別チャネルが紐付け中です。先に解放してください',
      )
    }

    // broadcast-guidelines-on-link: commit 後の要綱送信に broadcast 行の id が
    // 要る。既存行は再利用 (選択 join を保持)、新規は returning で id を取る。
    let boundBroadcastId: number
    if (existingBroadcast) {
      await tx
        .update(eventLineBroadcasts)
        .set({
          lineChannelId: input.channelId,
          lineGroupId: trimmedGroupId,
          status: 'linked',
          linkedAt: sql`now()`,
          revokedAt: null,
          revokeReason: null,
          releasedAt: null,
          inviteCode: null,
          inviteCodeExpiresAt: null,
          // 再紐付け = 新しいグループへ改めて送るので送信済み監査をクリア (AC-8)。
          // 選択 (join 行) は同一行 UPDATE なので保持される。
          guidelinesSentAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(eventLineBroadcasts.id, existingBroadcast.id))
      boundBroadcastId = existingBroadcast.id
    } else {
      const insertedBroadcast = await tx
        .insert(eventLineBroadcasts)
        .values({
          entryGroupId,
          lineChannelId: input.channelId,
          lineGroupId: trimmedGroupId,
          status: 'linked',
          linkedAt: sql`now()`,
        })
        .returning({ id: eventLineBroadcasts.id })
      boundBroadcastId = insertedBroadcast[0]!.id
    }

    // rr3 review blocker: 2 つの管理操作が並行実行されたとき、上の
    // findFirst で両方が「未割当」と判断して event_line_broadcasts を
    // 両方とも linked にしてしまうレースを潰す。line_channels UPDATE は
    // 「現在も available か、または同じグループへの assigned」のときだけ
    // 成立する条件付きにし、0 行返却なら競合とみなしてトランザクションを
    // ロールバックする。
    const channelUpdate = await tx
      .update(lineChannels)
      .set({
        status: 'active',
        assignedEntryGroupId: entryGroupId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(lineChannels.id, input.channelId),
          eq(lineChannels.purpose, 'event_broadcast'),
          sql`${lineChannels.status} IN ('available','assigned','active')`,
          sql`(${lineChannels.assignedEntryGroupId} IS NULL OR ${lineChannels.assignedEntryGroupId} = ${entryGroupId})`,
        ),
      )
      .returning({ id: lineChannels.id })

    if (channelUpdate.length === 0) {
      throw new Error(
        'チャネル状態が変わっています。再度ご確認のうえやり直してください',
      )
    }

    return {
      broadcastId: boundBroadcastId,
      lineGroupId: trimmedGroupId,
      channelAccessToken: channel.channelAccessToken,
    }
  })

  revalidatePath('/admin/line-channels')
  revalidatePath(`/admin/line-channels/${input.channelId}`)
  await revalidateGroupEventPaths(input.eventId)

  // broadcast-guidelines-on-link: 手動紐付けでも、選択済み要綱があれば同じ形式で
  // 送信する (AC-7)。linked は tx で commit 済みなので、送信の成否は紐付けに影響
  // しない (best-effort)。選択ゼロ (招待コードモーダル未表示のまま手動紐付け) は
  // ヘルパー側でクリーンに skip される。取りこぼしは events 画面の「要綱を再送」で
  // 復旧できる。
  //
  // AC-6: 送信失敗はログに残す。webhook 経路は構造化 logger を渡すが、Server
  // Action にはアンビエントロガーが無いため、mail-inbox の broadcast 失敗と同じ
  // console.error 系で記録する（sendGuidelinesOnLink は throw しない設計だが、
  // 万一の例外も linked を覆さないよう握りつぶしつつログする）。
  try {
    const result = await sendGuidelinesOnLink(
      db,
      {
        eventLineBroadcastId: linked.broadcastId,
        lineGroupId: linked.lineGroupId,
        channelAccessToken: linked.channelAccessToken,
      },
      {
        logger: {
          info: () => undefined,
          warn: (msg, ctx) => console.warn(`[manualLinkGroup] ${msg}`, ctx),
        },
      },
    )
    if (result.status === 'failed' || result.status === 'partial') {
      console.error('[manualLinkGroup] 要綱送信が完了しませんでした', {
        eventId: input.eventId,
        status: result.status,
        reason: result.reason,
      })
    }
  } catch (err) {
    // best-effort: 紐付けはコミット済み。送信失敗で巻き戻さない（ログのみ）。
    console.error('[manualLinkGroup] 要綱送信で想定外の例外', err)
  }
}
