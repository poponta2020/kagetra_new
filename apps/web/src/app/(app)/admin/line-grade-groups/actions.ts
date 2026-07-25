'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { lineChannels, lineGradeGroupBindings } from '@kagetra/shared/schema'
import { generateInviteCode, inviteCodeExpiresAt } from '@/lib/invite-code'
import { GRADES, type Grade } from './grades'

/**
 * event-grade-group-broadcast は admin のみ (AC-22)。同じディレクトリの
 * `admin/line-channels/actions.ts` の `requireAdminSession()` は
 * vice_admin も通すため、ここでは別名で独自定義し混同を避ける。
 */
async function requireStrictAdminSession() {
  const session = await auth()
  if (session?.user?.role !== 'admin') throw new Error('Forbidden')
  return session
}

/**
 * Server Action は公開エンドポイントで、`Grade` 型は実行時に消える。細工した
 * 呼び出しが級 enum 以外の値を渡すと Postgres 側の enum エラー
 * （`invalid input value for enum grade`）になり、内部エラーがそのまま
 * 露出する。入口で弾いて日本語エラーに揃える。
 */
function assertGrade(value: Grade): asserts value is Grade {
  if (!(GRADES as readonly string[]).includes(value)) {
    throw new Error('入力が不正です: 級を確認してください')
  }
}

export interface GeneratedGradeInviteCode {
  inviteCode: string
  expiresAt: Date
  botId: string
  botLabel: string
  addFriendUrl: string
}

/**
 * Issue (or re-issue) a 6-digit invite code for a grade's standing LINE
 * group binding.
 *
 * - If a binding row already exists for this grade, it is reused in place
 *   (grade has a UNIQUE constraint, so a fresh INSERT would violate it).
 *   Re-issuing tears down whatever state the row was in (including a live
 *   `linked` group) — the operator must re-invite the Bot to the group and
 *   speak the new code.
 * - If no binding exists yet, an `available` channel from the
 *   `event_broadcast` pool is optimistically claimed and converted to
 *   `purpose='grade_broadcast'` in the same transaction. Once converted, a
 *   channel never goes back to the event pool (see revokeGradeBinding).
 */
export async function generateGradeInviteCode(
  grade: Grade,
): Promise<GeneratedGradeInviteCode> {
  await requireStrictAdminSession()
  assertGrade(grade)

  const reservation = await db.transaction(async (tx) => {
    const existing = await tx.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.grade, grade),
    })

    // review r1 blocker: 紐付け済み (linked) の級で再発行を許すと、単なる
    // 「招待コードを再発行」の1操作で lineGroupId / linkedAt が消え、その級が
    // 無確認のまま配信対象から外れる（以後の大会案内が丸ごと欠落する）。
    // 既存の大会用 generateInviteCodeForEvent も linked を拒否しており、
    // 破壊的な付け替えは確認付きの「解除」を先に通す、が本リポジトリの流儀。
    if (existing && existing.status === 'linked') {
      throw new Error(
        '現在このグループと紐付け中です。解除してから再発行してください',
      )
    }

    let channelId: number

    if (existing) {
      channelId = existing.lineChannelId
    } else {
      // Optimistically claim one `event_broadcast` / `available` channel and
      // convert it to `grade_broadcast` in the same transaction. Mirrors the
      // UPDATE ... WHERE <pre-claim state> RETURNING pattern used by
      // manualLinkGroup / disableChannel in ../line-channels/actions.ts so
      // two concurrent grade invites can't both grab the same channel.
      const candidates = await tx
        .select({ id: lineChannels.id })
        .from(lineChannels)
        .where(
          and(
            eq(lineChannels.purpose, 'event_broadcast'),
            eq(lineChannels.status, 'available'),
            sql`${lineChannels.assignedEventId} IS NULL`,
          ),
        )
        .orderBy(asc(lineChannels.id))

      let claimedId: number | null = null
      for (const candidate of candidates) {
        const claimed = await tx
          .update(lineChannels)
          .set({ purpose: 'grade_broadcast', updatedAt: sql`now()` })
          .where(
            and(
              eq(lineChannels.id, candidate.id),
              eq(lineChannels.purpose, 'event_broadcast'),
              eq(lineChannels.status, 'available'),
              sql`${lineChannels.assignedEventId} IS NULL`,
            ),
          )
          .returning({ id: lineChannels.id })
        if (claimed[0]) {
          claimedId = claimed[0].id
          break
        }
      }

      if (claimedId == null) {
        throw new Error(
          'Bot プールが枯渇しています。/admin/line-channels で不要な Bot を解放してください',
        )
      }
      channelId = claimedId
    }

    // review r1 should_fix: invite_code は部分 UNIQUE（有効なコードのみ対象）
    // なので、低確率だが他の級のコードと衝突して 23505 で発行全体が落ちうる。
    // 既存 generateInviteCodeForEvent と同じく savepoint 付きで数回再試行する
    // （23505 以外は再試行しても無駄なので即座に投げ直す）。
    const MAX_ATTEMPTS = 3
    let inviteCode = ''
    let expiresAt = new Date()
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      inviteCode = generateInviteCode()
      expiresAt = inviteCodeExpiresAt()
      try {
        await tx.transaction(async (sp) => {
          if (existing) {
            await sp
              .update(lineGradeGroupBindings)
              .set({
                inviteCode,
                inviteCodeExpiresAt: expiresAt,
                status: 'invite_pending',
                lineGroupId: null,
                linkedAt: null,
                revokedAt: null,
                revokeReason: null,
                updatedAt: sql`now()`,
              })
              .where(eq(lineGradeGroupBindings.id, existing.id))
          } else {
            await sp.insert(lineGradeGroupBindings).values({
              grade,
              lineChannelId: channelId,
              inviteCode,
              inviteCodeExpiresAt: expiresAt,
              status: 'invite_pending',
            })
          }
        })
        lastError = null
        break
      } catch (err) {
        lastError = err
        const code = (err as { code?: string }).code
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
      // botId is the LINE basic ID (`@...`) — same friends-add URL format as
      // generateInviteCodeForEvent in ../../events/[id]/actions.ts.
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(channelRow.botId)}`,
    }
  })

  revalidatePath('/admin/line-grade-groups')

  return reservation
}

/**
 * Remove a grade's binding from the broadcast target set (AC-19) without
 * releasing its channel back to the event pool — grade bindings are
 * standing, not per-tournament (see line-grade-group-bindings.ts).
 *
 * inviteCode / inviteCodeExpiresAt are nulled out so the partial UNIQUE
 * index on invite_code doesn't block a later re-issue (same reasoning as
 * releaseChannel in ../line-channels/actions.ts).
 */
export async function revokeGradeBinding(grade: Grade): Promise<void> {
  await requireStrictAdminSession()
  assertGrade(grade)

  await db
    .update(lineGradeGroupBindings)
    .set({
      status: 'revoked',
      revokedAt: sql`now()`,
      revokeReason: 'manual',
      inviteCode: null,
      inviteCodeExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(lineGradeGroupBindings.grade, grade))

  revalidatePath('/admin/line-grade-groups')
}
