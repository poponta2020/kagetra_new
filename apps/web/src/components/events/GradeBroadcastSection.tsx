'use client'

import { useState, useTransition, type ReactNode } from 'react'
import type { Grade } from '@kagetra/shared/types'
import { formatDateTimeShort } from '@/lib/event-date'
import {
  DisclosureActions,
  DisclosureRow,
  FlatTable,
  LinkAction,
  type FlatTableRow,
} from './detail'

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
   * 行の見出し。既定は `級別グループ配信`。entry-group-page タスク3: グループ
   * ページは**日ごとに1行**出すので、複数日のときだけ呼び出し側が日を添えた
   * ラベル（例 `級別配信 9/5`）を渡して行を区別する。
   */
  label?: ReactNode
  /**
   * 対象級ごとの配信状況。`events.eligible_grades` から解決した級だけを
   * 並べる（null/空なら全5級）。
   */
  rows: readonly GradeBroadcastRow[]
  resendAction: (eventId: number) => Promise<void>
}

/**
 * event-grade-group-broadcast: 級別グループへの配信状況と再送導線。
 *
 * event-detail-redesign タスク5で独立セクションをやめ、`LineBroadcastSection`
 * の中の 1 項目（{@link DisclosureRow}）へ移した。表示・操作とも admin 限定
 * （AC-13c / AC-29）だが、そのガードは呼び出し側（page.tsx →
 * `LineBroadcastSection` の `gradeBroadcast` prop）が担う。このコンポーネント
 * 自身は admin チェックを行わない（現行どおり）。
 */
export function GradeBroadcastSection({
  eventId,
  label = '級別グループ配信',
  rows,
  resendAction,
}: GradeBroadcastSectionProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startResend] = useTransition()

  const sentCount = rows.filter((r) => r.sentAt).length
  const unsentCount = rows.length - sentCount
  const unlinkedRows = rows.filter((r) => !r.sentAt && !r.linked)

  const aux =
    unlinkedRows.length === 0
      ? undefined
      : unlinkedRows.length === 1
        ? `${unlinkedRows[0]?.grade}級 未紐付け`
        : `${unlinkedRows.length}級 未紐付け`

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

  const tableRows: FlatTableRow[] = rows.map((row) => {
    if (row.sentAt) {
      return {
        key: row.grade,
        label: `${row.grade}級`,
        value: `送信済み ${formatDateTimeShort(row.sentAt)}`,
        variant: 'date',
      }
    }
    if (row.linked) {
      return {
        key: row.grade,
        label: `${row.grade}級`,
        value: '未送信',
        valueClassName: 'text-ink-meta',
      }
    }
    return {
      key: row.grade,
      label: `${row.grade}級`,
      value: '未紐付け',
      valueClassName: 'text-accent-fg',
    }
  })

  return (
    <DisclosureRow
      label={label}
      value={`${sentCount} / ${rows.length} 送信済み`}
      aux={aux}
      auxTone="warn"
    >
      <FlatTable rows={tableRows} />
      <p className="mt-2 text-xs text-neutral-fg">
        送信済みの級には送りません（未送信の級だけに届きます）。
      </p>
      {error ? <p className="mt-1 text-xs text-danger-fg">{error}</p> : null}
      <DisclosureActions>
        <LinkAction
          disabled={isPending || unsentCount === 0}
          onClick={handleResend}
        >
          {isPending ? '送信中…' : '未送信の級へ配信'}
        </LinkAction>
      </DisclosureActions>
    </DisclosureRow>
  )
}
