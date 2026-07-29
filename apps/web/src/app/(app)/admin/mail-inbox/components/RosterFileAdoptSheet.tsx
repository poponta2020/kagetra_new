'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn, Card, Pill } from '@/components/ui'
import { adoptRosterFile, releaseRosterFile } from '../actions'
import type { LinkableEventOption } from './ExistingEventLinkSheet'

/**
 * roster-file-adoption タスク2: メール詳細の各添付に出す「名簿ファイルとして
 * 採用」導線。未採用なら採用フォーム（対象イベント・名簿種別・発表日）を出す
 * ボトムシート、採用済みなら採用状態（種別・対象大会名）表示 + 解除ボタンに
 * 切り替わる。
 *
 * ボトムシートの様式は ExistingEventLinkSheet と同じ
 * （createPortal(document.body) + `.modal-overlay-h`、overflow-y-auto コンテナに
 * min-h-0）。
 */

const ROSTER_TYPE_LABEL: Record<'applicant' | 'confirmed', string> = {
  applicant: '申込者名簿',
  confirmed: '確定名簿',
}

export interface RosterFileAdoptionInfo {
  id: number
  rosterType: 'applicant' | 'confirmed'
  /** 帰属する entry_group が持つ全イベントのタイトル（採用は entry_group 単位）。 */
  eventTitles: string[]
}

export function RosterFileAdoptSheet({
  attachmentId,
  attachmentFilename,
  linkableEvents,
  adoption,
}: {
  attachmentId: number
  attachmentFilename: string
  linkableEvents: LinkableEventOption[]
  adoption: RosterFileAdoptionInfo | null
}) {
  const [open, setOpen] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [rosterType, setRosterType] = useState<'applicant' | 'confirmed'>('applicant')
  const [publishedAt, setPublishedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Sheet を開いた時に状態をリセット（ExistingEventLinkSheet と同じ規約）。
  useEffect(() => {
    if (open) {
      setSelectedEventId(null)
      setRosterType('applicant')
      setPublishedAt('')
      setError(null)
    }
  }, [open])

  const onAdopt = () => {
    if (selectedEventId == null) return
    setError(null)
    startTransition(async () => {
      const result = await adoptRosterFile(
        attachmentId,
        selectedEventId,
        rosterType,
        publishedAt.trim() || null,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  const onRelease = () => {
    if (adoption == null) return
    setError(null)
    startTransition(async () => {
      const result = await releaseRosterFile(adoption.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (adoption) {
    return (
      <Card>
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="max-w-[65%] truncate text-ink-2">{attachmentFilename}</span>
            <Pill tone="success" size="sm">
              {ROSTER_TYPE_LABEL[adoption.rosterType]}
            </Pill>
          </div>
          <span className="text-xs text-ink-meta">
            対象大会: {adoption.eventTitles.length > 0 ? adoption.eventTitles.join('・') : '(不明)'}
          </span>
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <div>
            <Btn kind="ghost" size="sm" onClick={onRelease} disabled={pending}>
              {pending ? '処理中…' : '採用を解除'}
            </Btn>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="max-w-[60%] truncate text-ink-2">{attachmentFilename}</span>
          <Btn kind="secondary" size="sm" onClick={() => setOpen(true)} disabled={pending}>
            名簿ファイルとして採用
          </Btn>
        </div>
      </Card>
      {/* Portal + .modal-overlay-h (svh cascade): ExistingEventLinkSheet と同じ既知バグ回避。 */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adopt-roster-file-sheet-title"
          className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="adopt-roster-file-sheet-title"
              className="font-display text-base font-bold text-ink"
            >
              名簿ファイルとして採用
            </h2>
            <p className="mt-1 text-xs text-ink-meta">
              {attachmentFilename} を対象大会の名簿ファイルとして採用します。
            </p>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">名簿種別</span>
              <div className="flex gap-3">
                {(['applicant', 'confirmed'] as const).map((rt) => (
                  <label key={rt} className="flex items-center gap-1 text-sm text-ink">
                    <input
                      type="radio"
                      name="roster-file-type"
                      value={rt}
                      checked={rosterType === rt}
                      onChange={() => setRosterType(rt)}
                      disabled={pending}
                    />
                    {ROSTER_TYPE_LABEL[rt]}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-ink">対象イベント</span>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {linkableEvents.length === 0 ? (
                  <Card>
                    <div className="py-4 text-center text-xs text-ink-meta">
                      候補がありません
                    </div>
                  </Card>
                ) : (
                  linkableEvents.map((ev) => {
                    const checked = selectedEventId === ev.id
                    return (
                      <label
                        key={ev.id}
                        className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                          checked
                            ? 'border-brand bg-brand-bg'
                            : 'border-border-soft bg-surface'
                        }`}
                      >
                        <input
                          type="radio"
                          name="roster-file-event"
                          value={ev.id}
                          checked={checked}
                          onChange={() => setSelectedEventId(ev.id)}
                          disabled={pending}
                          className="mt-1"
                        />
                        <div className="flex flex-1 flex-col">
                          <span className="font-medium text-ink">{ev.title}</span>
                          <span className="text-xs text-ink-meta">{ev.eventDate}</span>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">
                発表日（任意・未入力ならメール受信日）
              </span>
              <input
                type="date"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                disabled={pending}
                className="rounded border border-border-soft bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>

            {error && (
              <p className="mt-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <Btn kind="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Btn>
              <Btn
                kind="primary"
                size="sm"
                onClick={onAdopt}
                disabled={pending || selectedEventId == null}
              >
                {pending ? '送信中…' : '採用する'}
              </Btn>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
