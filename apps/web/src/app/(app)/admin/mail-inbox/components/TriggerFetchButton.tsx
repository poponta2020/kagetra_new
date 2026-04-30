'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { triggerMailFetch } from '../actions'

type Preset = '24h' | '3d' | '7d' | 'custom'

interface PresetOption {
  value: Preset
  label: string
}

// Order mirrors pr5-plan.md Q5: 24h / 3d / 7d (default) / custom.
const PRESETS: PresetOption[] = [
  { value: '24h', label: '過去 24 時間' },
  { value: '3d', label: '過去 3 日' },
  { value: '7d', label: '過去 7 日' },
  { value: 'custom', label: '任意日付' },
]

/**
 * Header-right action on /admin/mail-inbox. Opens a small modal where an
 * admin picks a `since` preset and posts a job into `mail_worker_jobs`. The
 * mail-worker dispatcher (systemd timer, ~30 min cadence) claims the row
 * and runs the IMAP fetch on its next tick — so success feedback is
 * "ジョブ #N を予約しました" only. No progress polling in v1.
 *
 * Rendered as a Client Component because the dialog state, the form state,
 * and `useTransition` all need to live on the client. The Server Action
 * lives in `../actions.ts` and is imported as a function; the form posts
 * via JS rather than HTML form action so we can read the
 * `{ ok, jobId | error }` envelope and surface the result inline.
 */
export function TriggerFetchButton() {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>('7d')
  const [customDate, setCustomDate] = useState('')
  const [feedback, setFeedback] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; jobId: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Drive the native <dialog> element from the `open` state so consumers (and
  // Playwright's getByRole('dialog')) see the standard show/hide semantics.
  // showModal() also handles Esc-to-close + the backdrop blocker for free.
  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.showModal()
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open])

  const reset = () => {
    setPreset('7d')
    setCustomDate('')
    setFeedback({ kind: 'idle' })
  }

  const handleClose = () => {
    setOpen(false)
    reset()
  }

  const onSubmit = () => {
    setFeedback({ kind: 'idle' })
    startTransition(async () => {
      const fd = new FormData()
      fd.set('preset', preset)
      if (preset === 'custom') fd.set('customDate', customDate)
      try {
        const result = await triggerMailFetch(fd)
        if (result.ok) {
          setFeedback({ kind: 'success', jobId: result.jobId })
          // Refresh so the run history table picks up any state change the
          // worker may have written between submit and the redirect.
          router.refresh()
        } else {
          setFeedback({ kind: 'error', message: result.error })
        }
      } catch (e) {
        // Authorization failures throw from requireAdminSession(); surface
        // the message instead of crashing the client component.
        const msg = e instanceof Error ? e.message : 'unknown error'
        setFeedback({ kind: 'error', message: msg })
      }
    })
  }

  const submitDisabled =
    isPending || (preset === 'custom' && !customDate)

  return (
    <>
      <Btn kind="secondary" size="sm" onClick={() => setOpen(true)}>
        メール取り込み
      </Btn>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border bg-surface p-0 backdrop:bg-black/40"
        onClose={handleClose}
        aria-label="メール取り込み"
      >
        <div className="flex w-[min(92vw,420px)] flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink">
              メール取り込み
            </h2>
            <button
              type="button"
              className="text-ink-meta hover:text-ink"
              onClick={handleClose}
              aria-label="閉じる"
            >
              ×
            </button>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-2">
              取り込み期間
            </legend>
            {PRESETS.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`mail-fetch-preset-${opt.value}`}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  id={`mail-fetch-preset-${opt.value}`}
                  type="radio"
                  name="mail-fetch-preset"
                  value={opt.value}
                  checked={preset === opt.value}
                  onChange={() => setPreset(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>

          {preset === 'custom' && (
            <label className="flex flex-col gap-1 text-sm text-ink-2">
              <span>取り込み開始日 (JST 0:00 起点)</span>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          )}

          {feedback.kind === 'success' && (
            <p className="text-sm text-success-fg">
              ジョブ #{feedback.jobId} を予約しました。次回 cron 実行 (~30
              分以内) で処理されます
            </p>
          )}
          {feedback.kind === 'error' && (
            <p className="text-sm text-danger-fg">
              ジョブ予約失敗: {feedback.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Btn kind="ghost" size="md" onClick={handleClose} type="button">
              キャンセル
            </Btn>
            <Btn
              kind="primary"
              size="md"
              onClick={onSubmit}
              disabled={submitDisabled}
              type="button"
            >
              {isPending ? '予約中...' : '実行'}
            </Btn>
          </div>
        </div>
      </dialog>
    </>
  )
}
