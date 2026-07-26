'use client'

import { useState, useTransition } from 'react'
import { Btn, Card, Pill, SectionLabel } from '@/components/ui'
import type { Grade } from '@kagetra/shared/types'

export interface GradeBroadcastRow {
  grade: Grade
  /** 送信済みなら日時、未送信なら null。 */
  sentAt: Date | string | null
  /** その級のグループが現在紐付いているか（未紐付けなら送れない）。 */
  linked: boolean
}

export interface GradeBroadcastSectionProps {
  eventId: number
  /**
   * 対象級ごとの配信状況。`events.eligible_grades` から解決した級だけを
   * 並べる（null/空なら全5級）。
   */
  rows: readonly GradeBroadcastRow[]
  resendAction: (eventId: number) => Promise<void>
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

/**
 * event-grade-group-broadcast: 級別グループへの配信状況と再送導線。
 *
 * 大会別グループ配信（`LineBroadcastSection`）とは読み手も経路も別物なので、
 * セクションを分けて併記する。表示・操作とも **admin 限定**（AC-22）なので、
 * 呼び出し側で admin 以外には描画しないこと。
 */
export function GradeBroadcastSection({
  eventId,
  rows,
  resendAction,
}: GradeBroadcastSectionProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startResend] = useTransition()

  const unsentCount = rows.filter((r) => !r.sentAt).length
  const sentCount = rows.length - unsentCount

  function handleResend() {
    setError(null)
    startResend(async () => {
      try {
        await resendAction(eventId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '級グループへの再送に失敗しました')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionLabel>級別グループ配信</SectionLabel>
        <Pill tone={unsentCount === 0 ? 'success' : 'neutral'} size="sm">
          {sentCount} / {rows.length} 送信済み
        </Pill>
      </div>

      <Card className="px-3 py-3 flex flex-col gap-3 text-xs text-ink-2">
        <p className="text-[11px] text-ink-meta">
          対象級の LINE グループへ、この大会の概要を1通ずつ配信します。
        </p>

        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.grade} className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink-1">{row.grade}級</span>
              {row.sentAt ? (
                <span className="tabular-nums text-ink-meta">
                  送信済み {formatDateTime(row.sentAt)}
                </span>
              ) : row.linked ? (
                <span className="text-ink-meta">未送信</span>
              ) : (
                <span className="text-warn-fg">未紐付け</span>
              )}
            </li>
          ))}
        </ul>

        {error ? <p className="text-danger-fg">{error}</p> : null}

        <div>
          <Btn
            type="button"
            kind="secondary"
            size="sm"
            onClick={handleResend}
            disabled={isPending || unsentCount === 0}
          >
            {isPending ? '送信中…' : '級グループへ再送'}
          </Btn>
          <p className="mt-1 text-[11px] text-ink-meta">
            送信済みの級には送りません（未送信の級だけに届きます）。
          </p>
        </div>
      </Card>
    </section>
  )
}
