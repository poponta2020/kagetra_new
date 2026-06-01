/* mail-triage-badge: Web Push 用 Service Worker（プレーン JS、ビルド対象外）。
 *
 * - push: サーバ（mail-worker）からのペイロードで通知を出し、未処理数を
 *   アプリアイコンのバッジに反映する。iOS/iPadOS 16.4+ のホーム画面 PWA は
 *   navigator.setAppBadge() を SW コンテキストでサポートする（要通知許可）。
 * - notificationclick: 既存タブがあればフォーカス、無ければ受信箱を開く。
 *
 * ペイロード形: { title?: string, body?: string, url?: string, badge?: number }
 */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || '新着メール'
  const body = data.body || ''
  const url = data.url || '/admin/mail-inbox'
  const badge = data.badge

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        tag: data.tag || undefined,
        data: { url },
      })
      if (typeof badge === 'number' && 'setAppBadge' in navigator) {
        try {
          if (badge > 0) await navigator.setAppBadge(badge)
          else await navigator.clearAppBadge()
        } catch {
          /* バッジ更新失敗は通知本体に影響させない */
        }
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url =
    (event.notification.data && event.notification.data.url) ||
    '/admin/mail-inbox'

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })(),
  )
})
