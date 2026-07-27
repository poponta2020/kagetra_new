'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import { formatEventDate } from '@/lib/event-date'

export interface GroupToggleDialogOption {
  id: number
  /** 大会名。日付と並べて表示する（例: `8/1(土) C級`）。 */
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
  /** cancelled の日はチェックボックスを disabled にする（requirements §3.2.4）。 */
  disabled: boolean
}

export interface GroupToggleDialogProps {
  /** ダイアログの見出し（例: `申込済にする対象の日を選択`）。 */
  heading: string
  options: readonly GroupToggleDialogOption[]
  onCancel: () => void
  onConfirm: (selectedIds: number[]) => void
  confirmLabel?: string
  pending?: boolean
}

/**
 * entry-groups タスク4: 進行操作一括トグルの選択ダイアログ（requirements §3.2.4）。
 * 同グループの該当日を**既定で全チェック**、cancelled の日は選択不可にする。
 * `InviteCodeModal` と同じ `createPortal(document.body)` + `.modal-overlay-h`
 * パターンを踏襲する。
 */
export function GroupToggleDialog({
  heading,
  options,
  onCancel,
  onConfirm,
  confirmLabel = '実行',
  pending = false,
}: GroupToggleDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(options.filter((o) => !o.disabled).map((o) => o.id)),
  )

  // ダイアログを開き直す（options が入れ替わる）たびに既定選択へリセットする。
  useEffect(() => {
    setSelected(new Set(options.filter((o) => !o.disabled).map((o) => o.id)))
  }, [options])

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-h-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-surface p-4 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink-1">{heading}</h2>
        <ul className="flex flex-col gap-2">
          {options.map((o) => (
            <li key={o.id}>
              <label
                className={`flex items-center gap-2 rounded-lg bg-surface-alt px-2.5 py-2 text-[13px] text-ink-1 ${
                  o.disabled ? 'opacity-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border disabled:opacity-50"
                  checked={selected.has(o.id)}
                  disabled={o.disabled || pending}
                  onChange={() => toggle(o.id)}
                />
                <span>
                  {formatEventDate(o.eventDate)} {o.title}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Btn type="button" kind="secondary" size="sm" onClick={onCancel} disabled={pending}>
            キャンセル
          </Btn>
          <Btn
            type="button"
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
          >
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}
