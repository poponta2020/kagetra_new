'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/components/ui'
import { deletePushSubscription, savePushSubscription } from './actions'

// 公開鍵はクライアントに露出してよい（VAPID の公開鍵）。未設定ならボタンを出さない。
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

/** base64url の VAPID 公開鍵を applicationServerKey 用の Uint8Array に変換する。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // ArrayBuffer を明示する。TS 5.7 既定の `new Uint8Array(n)` は
  // Uint8Array<ArrayBufferLike>（SharedArrayBuffer を含む）になり、subscribe() の
  // applicationServerKey（BufferSource = ArrayBuffer ベース）へ代入できない。
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

type State =
  | 'loading'
  | 'unsupported'
  | 'no-key'
  | 'denied'
  | 'subscribed'
  | 'unsubscribed'

export function NotificationSettings() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported')
      return
    }
    if (!VAPID_PUBLIC_KEY) {
      setState('no-key')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? 'subscribed' : 'unsubscribed')
      } catch {
        if (!cancelled) setState('unsubscribed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = async () => {
    setBusy(true)
    setError(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'unsubscribed')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      const json = sub.toJSON()
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
        userAgent: navigator.userAgent,
      })
      setState('subscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : '通知の有効化に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async () => {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await deletePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setState('unsubscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : '通知の解除に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {state === 'loading' && (
        <p className="text-sm text-ink-meta">確認中…</p>
      )}
      {state === 'unsupported' && (
        <p className="text-sm text-ink-meta">
          この端末/ブラウザは Web 通知に対応していません。iPhone はホーム画面に追加した
          アプリ（PWA）から開いてください。
        </p>
      )}
      {state === 'no-key' && (
        <p className="text-sm text-danger-fg">
          サーバの通知キー（VAPID）が未設定です。管理者に連絡してください。
        </p>
      )}
      {state === 'denied' && (
        <p className="text-sm text-danger-fg">
          通知がブロックされています。ブラウザ/OS の設定でこのサイトの通知を許可してください。
        </p>
      )}
      {state === 'unsubscribed' && (
        <Btn kind="primary" size="md" disabled={busy} onClick={subscribe}>
          {busy ? '処理中…' : '通知を有効にする'}
        </Btn>
      )}
      {state === 'subscribed' && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-success-fg">通知は有効です</span>
          <Btn kind="secondary" size="sm" disabled={busy} onClick={unsubscribe}>
            {busy ? '処理中…' : '解除'}
          </Btn>
        </div>
      )}
      {error && <p className="text-sm text-danger-fg">{error}</p>}
    </div>
  )
}
