'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn, Card } from '@/components/ui'
import { linkMailToEvent } from '../actions'

/**
 * mail-inbox-mailer タスク4: 既存イベント結びつけ用のボトムシート。
 *
 * 要件 §3.1.6:
 * - デフォルト表示: 未開催 + 過去 30 日以内、受信日降順
 * - 検索ボックスで大会名フィルタ
 * - 選択 → 「結びつける」→ linkMailToEvent
 *
 * 候補は parent から `events` props で受け取る（Server Component で計算した
 * 結果を渡す）。検索はクライアントサイドで title contains フィルタ（候補数が
 * 高々数十なのでネットワーク往復不要）。
 */
export interface LinkableEventOption {
  id: number
  title: string
  eventDate: string
  status: 'draft' | 'published' | 'cancelled' | 'done'
}

export function ExistingEventLinkSheet({
  mailId,
  events,
  buttonLabel = '既存イベントに紐付ける',
  buttonKind = 'secondary',
}: {
  mailId: number
  events: LinkableEventOption[]
  buttonLabel?: string
  buttonKind?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Sheet を開いた時に状態をリセット。再オープン時に前回の選択が残らないように。
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedId(null)
      setError(null)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return events
    const q = query.trim().toLowerCase()
    return events.filter((e) => e.title.toLowerCase().includes(q))
  }, [events, query])

  const onConfirm = () => {
    if (selectedId == null) return
    const eventId = selectedId
    setError(null)
    startTransition(async () => {
      const result = await linkMailToEvent(mailId, eventId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.push('/admin/mail-inbox')
    })
  }

  return (
    <>
      <Btn kind={buttonKind} size="md" onClick={() => setOpen(true)} disabled={pending}>
        {buttonLabel}
      </Btn>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-event-sheet-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="link-event-sheet-title" className="font-display text-base font-bold text-ink">
              既存イベントに紐付ける
            </h2>
            {/* Codex r8 nit: 旧文言「受信日降順」は実装の event_date desc と
                ずれていたため修正。候補は loadLinkableEvents が開催日降順で
                返す（コード上もコメントもこちらが正）。 */}
            <p className="mt-1 text-xs text-ink-meta">
              未開催のイベント + 過去 30 日以内を開催日の新しい順で表示します。
            </p>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="大会名で絞り込み"
              className="mt-3 rounded border border-border-soft bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-meta"
              autoFocus
            />

            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <Card>
                  <div className="py-4 text-center text-xs text-ink-meta">
                    候補がありません
                  </div>
                </Card>
              ) : (
                filtered.map((ev) => {
                  const checked = selectedId === ev.id
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
                        name="link-event"
                        value={ev.id}
                        checked={checked}
                        onChange={() => setSelectedId(ev.id)}
                        className="mt-1"
                      />
                      <div className="flex flex-1 flex-col">
                        <span className="font-medium text-ink">{ev.title}</span>
                        <span className="text-xs text-ink-meta">
                          {ev.eventDate} / {ev.status}
                        </span>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            {error && (
              <p className="mt-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <Btn
                kind="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                キャンセル
              </Btn>
              <Btn
                kind="primary"
                size="sm"
                onClick={onConfirm}
                disabled={pending || selectedId == null}
              >
                {pending ? '送信中…' : '結びつける'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
