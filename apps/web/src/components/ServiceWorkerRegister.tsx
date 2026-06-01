'use client'

import { useEffect } from 'react'

/**
 * mail-triage-badge: Service Worker 登録 + 前景バッジ同期（client）。
 *
 * RootLayout に1つだけ置く。役割は2つ:
 *   1. /sw.js を登録（Web Push の受信 + 背景バッジ更新の土台）。
 *   2. 前景バッジ同期 — アプリ起動時 / タブが可視化したタイミングで未処理数 API
 *      を引き、navigator.setAppBadge で最新化する。他端末（他管理者）の処理結果は
 *      Push を待たずここで反映される（準リアルタイム同期）。
 *
 * count API は admin/vice_admin 以外には 401/403 を返す。member や未ログインでは
 * fetch が !ok になるだけで no-op なので、ここでは role を見ずに叩いてよい。
 * setAppBadge 非対応（Android Chrome 以外のデスクトップ等）でも feature detection
 * で安全にスキップする。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 登録失敗（非対応ブラウザ等）は黙ってスキップ */
      })
    }

    if (!('setAppBadge' in navigator)) return

    let cancelled = false
    const syncBadge = async () => {
      try {
        const res = await fetch('/api/admin/mail/unprocessed-count', {
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const { count } = (await res.json()) as { count: number }
        if (count > 0) await navigator.setAppBadge(count)
        else await navigator.clearAppBadge()
      } catch {
        /* オフライン等は無視。次の可視化で再試行される */
      }
    }

    void syncBadge()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncBadge()
    }
    // mail-triage-badge: 処理アクション後に TriageActions が dispatch する同期
    // イベント（経路③）。これで自端末で処理した直後にバッジが即減る。
    const onManualSync = () => {
      void syncBadge()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('mail-triage-badge:sync', onManualSync)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mail-triage-badge:sync', onManualSync)
    }
  }, [])

  return null
}
