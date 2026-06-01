'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { pushSubscriptions } from '@kagetra/shared/schema'

/**
 * mail-triage-badge: Web Push 購読の保存/削除（admin / vice_admin のみ）。
 *
 * クライアント（NotificationSettings）が PushSubscription を JSON 化して渡す。
 * 同一端末の再購読は endpoint UNIQUE で upsert する（endpoint は購読の同一性キー）。
 * 配信は mail-worker（タスク5）が push_subscriptions を読んで行う。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
}

export async function savePushSubscription(input: PushSubscriptionInput) {
  const session = await requireAdminSession()
  if (!input.endpoint || !input.p256dh || !input.auth) {
    throw new Error('invalid subscription')
  }

  await db
    .insert(pushSubscriptions)
    .values({
      userId: session.user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // 同一 endpoint を別ユーザーが使い回すケース（共用端末）も考慮し
        // userId も更新する。鍵はローテートし得るので毎回上書き。
        userId: session.user.id,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        lastUsedAt: sql`now()`,
      },
    })

  revalidatePath('/settings/notifications')
}

export async function deletePushSubscription(endpoint: string) {
  await requireAdminSession()
  if (!endpoint) return
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  revalidatePath('/settings/notifications')
}
