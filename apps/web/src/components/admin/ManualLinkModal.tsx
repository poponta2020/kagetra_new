'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/components/ui'

export interface LinkableEventOption {
  id: number
  title: string
  eventDate: string
}

export interface ManualLinkModalProps {
  channelId: number
  channelLabel: string
  /**
   * Events not yet linked to any broadcast row. Pre-computed server-side so
   * the modal does not need a fetch on open. May be empty when nothing is
   * eligible — in that case the dialog renders a guidance message instead
   * of the form.
   */
  candidateEvents: readonly LinkableEventOption[]
  action: (input: {
    channelId: number
    eventId: number
    lineGroupId: string
  }) => Promise<void>
}

/**
 * Fallback for when the LINE Webhook never delivered the `join`/code-message
 * pair. The operator looks up the group ID in the LINE app, picks an event
 * from the drop-down, and submits — the server action then bypasses the
 * invite-code flow and writes the binding directly.
 */
export function ManualLinkModal({
  channelId,
  channelLabel,
  candidateEvents,
  action,
}: ManualLinkModalProps) {
  const [open, setOpen] = useState(false)
  const [eventId, setEventId] = useState<string>('')
  const [lineGroupId, setLineGroupId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleClose() {
    if (pending) return
    setOpen(false)
    setError(null)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    const eventIdRaw = formData.get('eventId')
    const groupIdRaw = formData.get('lineGroupId')
    if (typeof eventIdRaw !== 'string' || eventIdRaw === '') {
      setError('大会を選択してください')
      return
    }
    if (typeof groupIdRaw !== 'string' || groupIdRaw.trim() === '') {
      setError('LINE グループ ID を入力してください')
      return
    }
    const parsedEventId = Number.parseInt(eventIdRaw, 10)
    if (!Number.isFinite(parsedEventId)) {
      setError('大会 ID が不正です')
      return
    }
    startTransition(async () => {
      try {
        await action({
          channelId,
          eventId: parsedEventId,
          lineGroupId: groupIdRaw.trim(),
        })
        setOpen(false)
        setEventId('')
        setLineGroupId('')
      } catch (e) {
        setError(e instanceof Error ? e.message : '紐付けに失敗しました')
      }
    })
  }

  return (
    <>
      <Btn kind="secondary" size="sm" onClick={() => setOpen(true)}>
        手動紐付け
      </Btn>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${channelLabel} 手動紐付け`}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={handleClose}
        >
          <div
            className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-ink-1">手動紐付け</h2>

            {candidateEvents.length === 0 ? (
              <p className="text-sm text-ink-2 py-4">
                紐付け可能な大会がありません。
              </p>
            ) : (
              <form action={handleSubmit} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-ink-2">
                  大会
                  <select
                    name="eventId"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    className="h-10 px-3 rounded-md border border-border bg-surface text-sm text-ink-1"
                    required
                    disabled={pending}
                  >
                    <option value="">選択してください</option>
                    {candidateEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title}（{event.eventDate}）
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-ink-2">
                  LINE グループ ID
                  <input
                    type="text"
                    name="lineGroupId"
                    value={lineGroupId}
                    onChange={(e) => setLineGroupId(e.target.value)}
                    placeholder="Cxxxxxxxxxxxxxxxxxxxxx"
                    className="h-10 px-3 rounded-md border border-border bg-surface text-sm text-ink-1 font-mono"
                    required
                    disabled={pending}
                  />
                </label>

                {error ? (
                  <p className="text-xs text-danger-fg">{error}</p>
                ) : null}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Btn
                    type="button"
                    kind="ghost"
                    size="sm"
                    onClick={handleClose}
                    disabled={pending}
                  >
                    キャンセル
                  </Btn>
                  <Btn type="submit" kind="primary" size="sm" disabled={pending}>
                    {pending ? '紐付け中…' : '紐付ける'}
                  </Btn>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
