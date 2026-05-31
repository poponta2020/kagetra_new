'use client'

import { useEffect, useState, useTransition } from 'react'
import { Btn } from '@/components/ui'

export interface InviteCodePayload {
  inviteCode: string
  expiresAt: Date
  botId: string
  botLabel: string
  addFriendUrl: string
}

export interface InviteCodeModalProps {
  eventTitle: string
  /** When non-null, modal opens with this payload. Reset to null to close. */
  payload: InviteCodePayload | null
  onClose: () => void
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleString('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function useCountdown(expiresAt: Date | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return ''
  const diffMs = Math.max(0, expiresAt.getTime() - now)
  const totalSec = Math.floor(diffMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function InviteCodeModal({
  eventTitle,
  payload,
  onClose,
}: InviteCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()
  const countdown = useCountdown(payload?.expiresAt ?? null)

  // Reset the "copied" badge when the modal is reopened with a new payload.
  useEffect(() => {
    if (payload) setCopied(false)
  }, [payload])

  if (!payload) return null

  function handleCopy() {
    if (!payload) return
    const code = payload.inviteCode
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(code)
        setCopied(true)
      } catch {
        // Clipboard access can be blocked (e.g. permissions on a freshly-installed
        // PWA) — surface the failure as a no-op rather than throwing into the
        // React tree. The code is still selectable in the modal.
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${eventTitle} の LINE 配信 招待コード`}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-1">招待コード</h2>
            <p className="text-[11px] text-ink-meta truncate">{eventTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-meta hover:text-ink-1 text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col items-center gap-2 py-4 bg-surface-alt rounded-xl">
          <div className="text-[11px] text-ink-meta">6 桁数字を LINE グループで発言</div>
          <div className="text-4xl font-mono font-semibold tracking-[0.4em] text-ink-1">
            {payload.inviteCode}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-meta tabular-nums">
            <span>残り {countdown}</span>
            <span>·</span>
            <span>{formatExpiry(payload.expiresAt)} まで</span>
          </div>
          <Btn type="button" kind="ghost" size="sm" onClick={handleCopy}>
            {copied ? 'コピーしました' : 'コードをコピー'}
          </Btn>
        </div>

        <ol className="text-xs text-ink-2 flex flex-col gap-1.5 list-decimal list-inside">
          <li>
            <a
              href={payload.addFriendUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              {payload.botLabel}
            </a>
            {' '}
            を友だち追加
          </li>
          <li>LINE で大会参加者グループを作成</li>
          <li>作成したグループに {payload.botLabel} を招待</li>
          <li>グループ内で上記 6 桁コードを発言</li>
        </ol>

        <p className="text-[10px] text-ink-meta">
          紐付けが完了すると、このセクションは「連携中」表示に切り替わります。
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
