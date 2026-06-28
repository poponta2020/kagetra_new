'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Btn } from '@/components/ui'
import { uploadRoster } from '../actions'

const FIELD =
  'mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-surface-alt file:px-2 file:py-1'
const LABEL = 'block text-xs font-semibold text-ink-meta tracking-[0.02em]'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Btn type="submit" kind="secondary" size="sm" disabled={pending}>
      {pending ? '取込中…' : '取込'}
    </Btn>
  )
}

/**
 * tournament-entry-rosters PR-3: 名簿 Excel のアップロード取込フォーム（管理者）。
 * uploadRoster Server Action を呼び、結果/エラーを表示する。最小 UI（design-spec 後に精緻化）。
 */
export function RosterUploadForm({
  eventId,
  rosterType,
  label,
}: {
  eventId: number
  rosterType: 'applicant' | 'confirmed'
  label: string
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(formData: FormData) {
    setMsg(null)
    formData.set('rosterType', rosterType)
    try {
      const r = await uploadRoster(eventId, formData)
      setMsg({ ok: true, text: `取込完了: ${r.entryCount}名（自会員 ${r.matchedUserCount}名）` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '取込に失敗しました' })
    }
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <span className="text-sm font-semibold text-ink">{label}を取り込む</span>
      <div>
        <label className={LABEL}>Excel ファイル（.xlsx / .xls）</label>
        <input type="file" name="file" accept=".xlsx,.xls" required className={FIELD} />
      </div>
      <div>
        <label className={LABEL}>発行日（任意）</label>
        <input type="date" name="publishedAt" className={FIELD} />
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton />
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-accent'}`}>{msg.text}</span>
        )}
      </div>
    </form>
  )
}
