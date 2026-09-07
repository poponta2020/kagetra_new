'use client'

import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { Btn } from '@/components/ui'
import type { AdvisorField, TravelReportSettings } from '@/lib/travel-report/settings'
import { saveTravelReportSettingsAction } from './actions'

const FIELDS: { field: AdvisorField; label: string; hint?: string }[] = [
  { field: 'advisorDepartment', label: '所属部局等' },
  { field: 'advisorTitle', label: '職' },
  { field: 'advisorName', label: '氏名' },
]

/** 初期値の null を空欄（未入力）に正規化する。 */
function toInputValues(initial: TravelReportSettings): Record<AdvisorField, string> {
  const result = {} as Record<AdvisorField, string>
  for (const { field } of FIELDS) result[field] = initial[field] ?? ''
  return result
}

export function TravelReportSettingsForm({ initial }: { initial: TravelReportSettings }) {
  const [values, setValues] = useState<Record<AdvisorField, string>>(() =>
    toInputValues(initial),
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await saveTravelReportSettingsAction(values)
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
          <label htmlFor={`travel-report-settings-${field}`} className="text-[11px] text-ink-meta">
            {label}
          </label>
          <input
            id={`travel-report-settings-${field}`}
            type="text"
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
