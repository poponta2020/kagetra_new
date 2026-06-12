import Link from 'next/link'
import { Pill } from '@/components/ui'

export interface AttachmentChip {
  id: number
  filename: string
  contentType: string
  extractionStatus: 'pending' | 'extracted' | 'failed' | 'unsupported'
}

export interface AttachmentListProps {
  items: readonly AttachmentChip[]
  /**
   * ビューアの ✕ の戻り先としてチップ URL に付与する現在画面のパス
   * (例: `/admin/mail-inbox/mail/12`)。省略時のビューアは受信箱一覧に戻る。
   * window.history.length での推測は deep link で誤動作するため、戻り先は
   * 常に明示的に渡す (codex pr146 r1 should_fix)。
   */
  from?: string
}

const ICON_BY_TYPE: Record<string, string> = {
  pdf: '📄',
  docx: '📝',
  xlsx: '📊',
  zip: '📦',
  image: '🖼',
  default: '📎',
}

export function pickAttachmentIcon(
  contentType: string,
  filename: string,
): string {
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
 * Each chip opens the in-app viewer page (same-window navigation, so the ✕
 * there can history-back to this screen). Linking the binary route directly
 * — even with target="_blank" — dead-ends on the iOS home-screen PWA:
 * same-origin URLs are inside the manifest scope, so the standalone WebView
 * navigates itself onto the document and offers no UI to come back.
 *
 * failed/unsupported chips still render (the operator may want to inspect
 * the original by hand) but are tinted via Pill tone.
 */
export function AttachmentList({ items, from }: AttachmentListProps) {
  if (items.length === 0) return null
  const fromQuery = from ? `?from=${encodeURIComponent(from)}` : ''
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {items.map((item) => {
        const tone =
          item.extractionStatus === 'failed'
            ? 'danger'
            : item.extractionStatus === 'unsupported'
              ? 'neutral'
              : 'info'
        const icon = pickAttachmentIcon(item.contentType, item.filename)
        return (
          <Link
            key={item.id}
            href={`/admin/mail-inbox/attachments/${item.id}${fromQuery}`}
            className="inline-flex"
          >
            <Pill tone={tone} size="sm">
              <span className="mr-1">{icon}</span>
              <span className="max-w-[14rem] truncate align-middle">{item.filename}</span>
            </Pill>
          </Link>
        )
      })}
    </div>
  )
}
