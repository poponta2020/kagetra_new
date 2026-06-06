import webpush from 'web-push'
import { count, eq, inArray, ne } from 'drizzle-orm'
import { mailMessages, pushSubscriptions, users } from '@kagetra/shared/schema'
import type { Db } from '../db.js'
import type { WebPushConfig } from '../config.js'
import type { NotifyLogger } from './line.js'

export interface NewMailInfo {
  subject: string | null
  fromName: string | null
  fromAddress: string
}

const NOOP_LOGGER: NotifyLogger = {
  info: () => undefined,
  warn: () => undefined,
}

/**
 * mail-triage-badge: 新着メール1件を admin/vice_admin の全 Web Push 購読へ配信する。
 *
 * - ペイロードに未処理総数（triage_status != 'processed'）を `badge` として載せ、
 *   Service Worker (apps/web/public/sw.js) が navigator.setAppBadge で反映する。
 * - HTTP 410(Gone)/404 が返った購読は失効とみなし push_subscriptions から削除する。
 * - 送信失敗は best-effort（呼び出し元の pipeline を止めない）。既存の LINE 通知
 *   (line.ts) とは独立した別レイヤ。
 */
export async function notifyNewMailPush(
  db: Db,
  config: WebPushConfig,
  mail: NewMailInfo,
  logger: NotifyLogger = NOOP_LOGGER,
): Promise<void> {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)

  // バッジは未処理総数（= unprocessed）。count API と同じ条件。
  // mail-inbox-mailer: 2 状態化により deferred は廃止。
  const [row] = await db
    .select({ value: count() })
    .from(mailMessages)
    .where(ne(mailMessages.triageStatus, 'processed'))
  const badge = row?.value ?? 0

  // 配信先は admin / vice_admin の全端末（購読は端末ごと）。
  const subs = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(pushSubscriptions.userId, users.id))
    .where(inArray(users.role, ['admin', 'vice_admin']))
  if (subs.length === 0) return

  const from = mail.fromName ?? mail.fromAddress
  const subject = mail.subject ?? '(件名なし)'
  const payload = JSON.stringify({
    title: '新着メール',
    body: `${from}: ${subject}`.slice(0, 200),
    url: '/admin/mail-inbox',
    badge,
  })

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      )
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        // 失効した購読は削除（端末が購読を取り消した / 期限切れ）。
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, sub.endpoint))
          .catch(() => undefined)
        logger.info('removed expired push subscription', {
          endpoint: sub.endpoint,
        })
      } else {
        logger.warn('web push send failed', {
          endpoint: sub.endpoint,
          statusCode,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}
