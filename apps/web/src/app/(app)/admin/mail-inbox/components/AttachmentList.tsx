import { Pill } from '@/components/ui'

export interface AttachmentChip {
  id: number
  filename: string
  contentType: string
  extractionStatus: 'pending' | 'extracted' | 'failed' | 'unsupported'
}

export interface AttachmentListProps {
  items: readonly AttachmentChip[]
}

const ICON_BY_TYPE: Record<string, string> = {
  pdf: '📄',
  docx: '📝',
  xlsx: '📊',
  zip: '📦',
  image: '🖼',
  default: '📎',
}

function pickIcon(contentType: string, filename: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('pdf')) return ICON_BY_TYPE.pdf!
  if (ct.includes('wordprocessingml')) return ICON_BY_TYPE.docx!
  if (ct.includes('spreadsheetml')) return ICON_BY_TYPE.xlsx!
  if (ct.startsWith('image/')) return ICON_BY_TYPE.image!
  if (ct.includes('zip')) return ICON_BY_TYPE.zip!
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return ICON_BY_TYPE.pdf!
  if (lower.endsWith('.docx')) return ICON_BY_TYPE.docx!
  if (lower.endsWith('.xlsx')) return ICON_BY_TYPE.xlsx!
  if (lower.endsWith('.zip')) return ICON_BY_TYPE.zip!
  return ICON_BY_TYPE.default!
}

/**
 * Inline chip row for attachments on the /admin/mail-inbox list. Renders
 * nothing when the mail has no attachments, so callers can drop it
 * unconditionally into a row without an outer guard.
 *
 * Each chip links to the binary route; failed/unsupported chips still render
 * (the operator may want to download the original to inspect by hand) but
 * are tinted via Pill tone.
 */
export function AttachmentList({ items }: AttachmentListProps) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {items.map((item) => {
        const tone =
          item.extractionStatus === 'failed'
            ? 'danger'
            : item.extractionStatus === 'unsupported'
              ? 'neutral'
              : 'info'
        const icon = pickIcon(item.contentType, item.filename)
        return (
          <a
            key={item.id}
            href={`/api/admin/mail/attachments/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Pill tone={tone} size="sm">
              <span className="mr-1">{icon}</span>
              <span className="max-w-[14rem] truncate align-middle">{item.filename}</span>
            </Pill>
          </a>
        )
      })}
    </div>
  )
}
