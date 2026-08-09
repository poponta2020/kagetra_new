import Link from 'next/link'
import { pickAttachmentIcon } from '@/app/(app)/admin/mail-inbox/components/AttachmentList'
import { formatAttachmentMeta } from '@/lib/member-mail/format'

/**
 * member-mail-search タスク5: 詳細画面の添付ファイル行リスト（requirements.md §3.5・
 * design-spec.md §3/§4 の `.attrow`）。一覧の添付チップ（`MailCard`）とは別コンポーネント
 * — 詳細はサイズ付きの行リストで、モックの `edge.html` ② が7件でも読める形として確定した。
 */

export interface MailAttachmentRowItem {
  id: number
  filename: string
  contentType: string
  sizeBytes: number
}

export interface MailAttachmentRowsProps {
  items: readonly MailAttachmentRowItem[]
  /** リンク先ビューアの `?from=` に渡す現在の詳細画面パス。 */
  mailId: number
}

export function MailAttachmentRows({ items, mailId }: MailAttachmentRowsProps) {
  const fromQuery = `?from=${encodeURIComponent(`/mail/${mailId}`)}`
  return (
    <div className="flex flex-col">
      {items.map((item, index) => (
        <Link
          key={item.id}
          href={`/mail/attachments/${item.id}${fromQuery}`}
          className={`flex items-center gap-[9px] py-[9px] px-1 ${
            index < items.length - 1 ? 'border-b border-border-soft' : ''
          }`}
        >
          <span className="shrink-0 text-base">
            {pickAttachmentIcon(item.contentType, item.filename)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="break-all text-xs leading-tight text-ink">{item.filename}</span>
            <span className="text-[10px] text-ink-meta">
              {formatAttachmentMeta(item.contentType, item.filename, item.sizeBytes)}
            </span>
          </span>
          <span className="shrink-0 text-[13px] text-ink-muted">›</span>
        </Link>
      ))}
    </div>
  )
}
