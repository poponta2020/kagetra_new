'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui'

/**
 * mail-inbox-mailer タスク4: AI 抽出ジョブ進行中の表示。
 *
 * 3 秒間隔で `/api/admin/mail-inbox/[id]/draft-status` を polling し、
 * draft.status が `'pending_review'` または `'ai_failed'` に変わったら
 * `router.refresh()` でサーバー側 RSC を再取得（DraftCard / 再試行カードに切替）。
 *
 * polling は visible 中のみ動かす（背景タブで無駄な fetch をしない）。
 * unmount / 状態確定で停止。
 */
export function ExtractionInProgressCard({ mailId }: { mailId: number }) {
  const router = useRouter()
  // dev 環境の React StrictMode で 2 重 effect になっても polling は idempotent
  // なので ref ガードは付けない。代わりに setInterval を 1 つだけ作って unmount
  // で確実に clear する。
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false

    async function tick() {
      if (stoppedRef.current) return
      try {
        const res = await fetch(`/api/admin/mail-inbox/${mailId}/draft-status`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const body = (await res.json()) as {
          draft: { status: string } | null
        }
        if (!body.draft) return
        if (
          body.draft.status === 'pending_review' ||
          body.draft.status === 'ai_failed' ||
          body.draft.status === 'approved' ||
          body.draft.status === 'rejected'
        ) {
          stoppedRef.current = true
          if (timerRef.current) clearInterval(timerRef.current)
          router.refresh()
        }
      } catch {
        // 失敗は一時的なネットワーク断扱い。次の tick でリトライ。
      }
    }

    timerRef.current = setInterval(tick, 3000)
    // immediate first poll (page open 直後の状態をすぐ取りに行く)
    void tick()

    return () => {
      stoppedRef.current = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [mailId, router])

  return (
    <Card>
      <div className="flex items-center gap-3 py-2">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-ink">AI 抽出中…</span>
          <span className="text-xs text-ink-meta">
            完了したら通知します（数十秒）。
          </span>
        </div>
      </div>
    </Card>
  )
}
