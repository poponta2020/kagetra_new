'use client'

import { useEffect, useState, useTransition } from 'react'
import { Btn } from '@/components/ui'

export interface RegistrationInvitePayload {
  /** Full `/register/<token>` URL to hand out. */
  url: string
  expiresAt: Date
}

export interface RegistrationInviteModalProps {
  /** When non-null, the modal is open with this payload. Reset to null to close. */
  payload: RegistrationInvitePayload | null
  onClose: () => void
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleString('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * Coarse "time left" string. Unlike InviteCodeModal's mm:ss (30-minute TTL),
 * registration links live 1–30 days, so we show days/hours and refresh once a
 * minute rather than every second.
 */
function useRemaining(expiresAt: Date | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return ''
  const diffMs = Math.max(0, expiresAt.getTime() - now)
  const totalMin = Math.floor(diffMs / 60_000)
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins = totalMin % 60
  if (totalMin <= 0) return '期限切れ'
  if (days > 0) return `あと ${days}日 ${hours}時間`
  if (hours > 0) return `あと ${hours}時間 ${mins}分`
  return `あと ${mins}分`
}

/**
 * Post-issue modal for an invite link. Shows the full URL (selectable +
 * copy button), the remaining time, and the absolute expiry. Mirrors the
 * InviteCodeModal layout/interaction (bottom-sheet on mobile, copy-with-badge).
 */
export function RegistrationInviteModal({ payload, onClose }: RegistrationInviteModalProps) {
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()
  const remaining = useRemaining(payload?.expiresAt ?? null)

  useEffect(() => {
    if (payload) setCopied(false)
  }, [payload])

  if (!payload) return null

  function handleCopy() {
    if (!payload) return
    const url = payload.url
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch {
        // Clipboard may be blocked (PWA permissions etc.) — the URL is still
        // selectable in the box, so degrade to a no-op rather than throwing.
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="招待リンク"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">招待リンクを発行しました</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-meta hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col gap-2 p-3 bg-surface-alt rounded-xl">
          <div className="text-[11px] text-ink-meta">このURLを新入会者に渡してください</div>
          <div className="text-xs font-mono text-ink break-all select-all bg-surface rounded-lg p-2 border border-border">
            {payload.url}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-meta tabular-nums">
              {remaining} · {formatExpiry(payload.expiresAt)} まで
            </span>
            <Btn type="button" kind="ghost" size="sm" onClick={handleCopy}>
              {copied ? 'コピーしました' : 'URLをコピー'}
            </Btn>
          </div>
        </div>

        <p className="text-[10px] text-ink-meta">
          期限内なら複数の人がこのリンクから会員登録できます。配布をやめたいときは一覧から無効化してください。
        </p>

        <div className="flex justify-end pt-1">
          <Btn type="button" kind="secondary" size="sm" onClick={onClose}>
            閉じる
          </Btn>
        </div>
      </div>
    </div>
  )
}
