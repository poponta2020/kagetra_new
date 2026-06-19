'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { triggerResultParse } from '../actions'

export interface ExcelAttachment {
  id: number
  filename: string
}

/**
 * tournament-results Task3: 「結果として取り込む」ボタン。
 *
 * - Excel 添付が 1 件のとき: ボタン1クリックで即キュー
 * - Excel 添付が複数のとき: select で選択後にキュー
 * - ジョブ登録後はページをリロードしてドラフト状態を反映する
 */
export function ResultParseButton({
  mailId,
  excelAttachments,
}: {
  mailId: number
  excelAttachments: ExcelAttachment[]
}) {
  const [selectedId, setSelectedId] = useState<number>(
    excelAttachments[0]?.id ?? 0,
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const handleSubmit = () => {
    if (!selectedId) return
    setError(null)
    startTransition(async () => {
      const result = await triggerResultParse(mailId, selectedId)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  if (excelAttachments.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {excelAttachments.length > 1 && (
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          disabled={pending}
          className="w-full rounded border border-border bg-surface p-2 text-sm text-ink"
        >
          {excelAttachments.map((att) => (
            <option key={att.id} value={att.id}>
              {att.filename}
            </option>
          ))}
        </select>
      )}
      {excelAttachments.length === 1 && (
        <p className="text-xs text-ink-meta">{excelAttachments[0]!.filename}</p>
      )}
      <Btn kind="primary" size="md" onClick={handleSubmit} disabled={pending || !selectedId}>
        {pending ? '登録中…' : '結果として取り込む'}
      </Btn>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  )
}
