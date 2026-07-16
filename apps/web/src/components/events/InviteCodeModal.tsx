'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import type { GuidelineCandidateMail } from '@/lib/event-related-mails'

export interface InviteCodePayload {
  inviteCode: string
  expiresAt: Date
  botId: string
  botLabel: string
  addFriendUrl: string
  // broadcast-guidelines-on-link: モーダルの「要綱として送信するファイル」選択
  // リスト用。候補は関連メール別（受信日時降順・添付 id 昇順）、選択済みは当該
  // LINE 連携行に保持済みの添付 id。
  guidelineCandidates: GuidelineCandidateMail[]
  selectedGuidelineAttachmentIds: number[]
}

export interface InviteCodeModalProps {
  eventId: number
  eventTitle: string
  /** When non-null, modal opens with this payload. Reset to null to close. */
  payload: InviteCodePayload | null
  onClose: () => void
  setGuidelineAttachmentsAction: (
    eventId: number,
    attachmentIds: number[],
  ) => Promise<void>
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleString('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatMailReceivedAt(receivedAt: Date): string {
  return receivedAt.toLocaleString('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** bytes を人間可読なサイズ表記へ整形する（例: 12.3 KB / 1.2 MB）。 */
function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
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
  eventId,
  eventTitle,
  payload,
  onClose,
  setGuidelineAttachmentsAction,
}: InviteCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()
  const countdown = useCountdown(payload?.expiresAt ?? null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [guidelineError, setGuidelineError] = useState<string | null>(null)

  // Reset the "copied" badge when the modal is reopened with a new payload.
  useEffect(() => {
    if (payload) setCopied(false)
  }, [payload])

  // Reset the selection from the freshly-loaded payload whenever the modal
  // (re)opens with a new payload (mirrors the copied-badge reset above).
  useEffect(() => {
    if (payload) {
      setSelectedIds(new Set(payload.selectedGuidelineAttachmentIds))
      setGuidelineError(null)
    }
  }, [payload])

  if (!payload) return null

  function toggleAttachment(attachmentId: number) {
    const next = new Set(selectedIds)
    if (next.has(attachmentId)) next.delete(attachmentId)
    else next.add(attachmentId)
    setSelectedIds(next)
    setGuidelineError(null)
    startTransition(async () => {
      try {
        await setGuidelineAttachmentsAction(eventId, Array.from(next))
      } catch (e) {
        // Optimistic toggle failed server-side — revert the local checkbox
        // state so the UI doesn't lie about what's actually saved.
        setSelectedIds(selectedIds)
        setGuidelineError(
          e instanceof Error ? e.message : '要綱の選択保存に失敗しました',
        )
      }
    })
  }

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

  // Portal + .modal-overlay-h (svh cascade): 祖先の stacking context を脱出し、
  // iOS viewport-fit=cover の dvh 罠を svh で回避（RankingFilterBar の同コメント参照）。
  // payload はクリック起点でしか非 null にならないので SSR で portal は走らない。
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${eventTitle} の LINE 配信 招待コード`}
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-full overflow-y-auto w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4"
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

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-1">
            要綱として送信するファイル
          </h3>
          {payload.guidelineCandidates.length === 0 ? (
            <p className="text-[11px] text-ink-meta bg-surface-alt rounded-xl px-3 py-3">
              送信できる添付ファイルがありません
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {payload.guidelineCandidates.map((mail) => (
                <div key={mail.mailId} className="flex flex-col gap-1.5">
                  <div className="text-[11px] text-ink-meta">
                    <span className="text-ink-2">
                      {mail.subject || '(件名なし)'}
                    </span>
                    {' '}
                    ・{formatMailReceivedAt(mail.receivedAt)}
                  </div>
                  <ul className="flex flex-col gap-1 pl-1">
                    {mail.attachments.map((att) => (
                      <li key={att.id}>
                        <label className="flex items-center gap-2 rounded-lg bg-surface-alt px-2.5 py-2 text-xs text-ink-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={selectedIds.has(att.id)}
                            onChange={() => toggleAttachment(att.id)}
                          />
                          <span className="flex-1 truncate">{att.filename}</span>
                          <span className="text-[10px] text-ink-meta tabular-nums">
                            {formatFileSize(att.sizeBytes)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {guidelineError ? (
            <p className="text-xs text-danger-fg">{guidelineError}</p>
          ) : null}
        </div>

        <p className="text-[10px] text-ink-meta">
          紐付けが完了すると、このセクションは「連携中」表示に切り替わります。
        </p>

        <div className="flex justify-end pt-1">
          <Btn type="button" kind="secondary" size="sm" onClick={onClose}>
            閉じる
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}
