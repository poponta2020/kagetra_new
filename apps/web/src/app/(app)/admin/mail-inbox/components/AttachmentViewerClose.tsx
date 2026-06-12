'use client'

import { useRouter } from 'next/navigation'

/**
 * ✕ button for the attachment viewer header. Returns to whichever screen
 * the chip was tapped on (inbox list / mail detail / draft detail) via
 * history back; a direct deep-link open (no in-app history, e.g. a cold
 * PWA start on the viewer URL) falls back to the inbox.
 */
export function AttachmentViewerClose() {
  const router = useRouter()
  return (
    <button
      type="button"
      aria-label="閉じる"
      onClick={() => {
        if (window.history.length > 1) {
          router.back()
        } else {
          router.replace('/admin/mail-inbox')
        }
      }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none text-ink-2 hover:bg-surface-alt"
    >
      ✕
    </button>
  )
}
