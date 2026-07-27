'use client'

import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { Btn } from '@/components/ui'
import type { HeaderField } from '@/lib/entry-form/cell-map'
import type { EntryFormSettings } from '@/lib/entry-form/settings'
import { saveEntryFormSettingsAction } from './actions'

const FIELDS: { field: HeaderField; label: string; hint?: string }[] = [
  { field: 'prefecture', label: '都道府県' },
  { field: 'clubName', label: '所属会名' },
  {
    field: 'managerName',
    label: '申込責任者氏名',
    hint: 'メール本文の署名（姓）にも使われます',
  },
  { field: 'phone', label: '連絡先電話番号' },
  {
    field: 'email',
    label: '連絡先 E-Mail',
    hint: '下書きの差出人（From）になります',
  },
  {
    field: 'transferName',
    label: '振込名義人',
    hint: '申込書に振込名義人欄がある場合に記入されます',
  },
]

/** 初期値の null を空欄（未入力）に正規化する。 */
function toInputValues(initial: EntryFormSettings): Record<HeaderField, string> {
  const result = {} as Record<HeaderField, string>
  for (const { field } of FIELDS) result[field] = initial[field] ?? ''
  return result
}

export function EntryFormSettingsForm({ initial }: { initial: EntryFormSettings }) {
  const [values, setValues] = useState<Record<HeaderField, string>>(() => toInputValues(initial))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await saveEntryFormSettingsAction(values)
        setSaved(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {FIELDS.map(({ field, label, hint }) => (
        <div key={field} className="flex flex-col gap-[3px]">
          <label htmlFor={`entry-form-settings-${field}`} className="text-[11px] text-ink-meta">
            {label}
          </label>
          <input
            id={`entry-form-settings-${field}`}
            type={field === 'email' ? 'email' : 'text'}
            value={values[field]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field]: event.target.value }))
            }
            className="rounded-md border border-border bg-surface px-[10px] py-[9px] text-sm text-ink"
          />
          {hint ? <span className="text-[10px] text-ink-muted">{hint}</span> : null}
        </div>
      ))}

      {error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="text-xs text-success-fg">
          保存しました
        </p>
      ) : null}

      <Btn kind="primary" size="lg" type="submit" disabled={pending} block>
        {pending ? '保存中…' : '保存'}
      </Btn>
    </form>
  )
}
