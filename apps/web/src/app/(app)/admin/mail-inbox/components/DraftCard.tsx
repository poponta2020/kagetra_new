import { composeTitle } from '@kagetra/mail-worker/classify/title'
import { Pill } from '@/components/ui'
import { ConfidenceBadge } from './ConfidenceBadge'

export interface DraftCardProps {
  draft: {
    status:
      | 'pending_review'
      | 'approved'
      | 'rejected'
      | 'ai_failed'
      | 'superseded'
    confidence: string | null // numeric(3,2) → string from drizzle
    isCorrection: boolean
    referencesSubject: string | null
    extractedPayload: unknown // jsonb — narrow defensively below
  }
}

/**
 * One-line summary of a tournament_drafts row, shown inline under each mail
 * card on /admin/mail-inbox. Detail view lives in /admin/mail-inbox/[id]
 * which is built by PR4.
 *
 * Layout mirrors AttachmentList: small row of inline pills + a single line
 * of extracted text underneath. The component renders no extracted text
 * row when the LLM extracted no title (ai_failed or empty payload) — pills
 * are always shown so the operator knows the draft exists.
 */
export function DraftCard({ draft }: DraftCardProps) {
  // Defensive narrowing: extracted_payload jsonb is `unknown` until we trust
  // the row. Read top-level fields without re-running the Zod schema (would
  // pull mail-worker's Zod into the web bundle); the admin UI already trusts
  // the worker's output since the row only exists if extraction completed.
  //
  // tournament-title-grade-split: new payloads carry `short_name_stem` +
  // `events[]`; compose each unit's short name (場所+級) and join them, e.g.
  // 「大阪B, 大阪C（2件）」. Old payloads (single `extracted.title`) fall back to
  // that full title.
  const payload = (draft.extractedPayload ?? {}) as {
    short_name_stem?: string | null
    events?: {
      event_date?: string | null
      eligible_grades?: ('A' | 'B' | 'C' | 'D' | 'E')[] | null
    }[]
    extracted?: { title?: string | null; event_date?: string | null }
  }

  let title: string | null = null
  let eventDate: string | null = null
  if (Array.isArray(payload.events) && payload.events.length > 0) {
    const stem = payload.short_name_stem ?? null
    const names = payload.events.map(
      (u) => composeTitle(stem, u.eligible_grades ?? null) || '(無題)',
    )
    title =
      names.length > 1
        ? `${names.join(', ')}（${names.length}件）`
        : (names[0] ?? null)
    // Single-unit drafts show the date; multi-date splits omit it (each unit
    // has its own date, shown on the detail page).
    eventDate =
      payload.events.length === 1
        ? (payload.events[0]?.event_date ?? null)
        : null
  } else {
    title = payload?.extracted?.title ?? null
    eventDate = payload?.extracted?.event_date ?? null
  }

  const confidenceNum =
    draft.confidence === null || draft.confidence === ''
      ? null
      : Number(draft.confidence)

  return (
    <div className="mt-2 flex flex-col gap-1 rounded-[6px] border border-border-soft bg-surface-alt p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={draft.status} />
        <ConfidenceBadge confidence={confidenceNum} />
        {draft.isCorrection && (
          <Pill tone="warn" size="sm">
            ⚠{' '}
            {draft.referencesSubject
              ? `${draft.referencesSubject} の訂正版?`
              : '訂正版?'}
          </Pill>
        )}
      </div>
      {(title || eventDate) && (
        <div className="text-ink-2">
          {title && <span className="font-medium">{title}</span>}
          {title && eventDate && (
            <span className="text-ink-muted"> · </span>
          )}
          {eventDate && <span>{eventDate}</span>}
        </div>
      )}
    </div>
  )
}

function StatusPill({
  status,
}: {
  status: DraftCardProps['draft']['status']
}) {
  switch (status) {
    case 'pending_review':
      return (
        <Pill tone="info" size="sm">
          承認待ち
        </Pill>
      )
    case 'approved':
      return (
        <Pill tone="success" size="sm">
          承認済
        </Pill>
      )
    case 'rejected':
      return (
        <Pill tone="neutral" size="sm">
          却下
        </Pill>
      )
    case 'ai_failed':
      return (
        <Pill tone="danger" size="sm">
          AI 失敗
        </Pill>
      )
    case 'superseded':
      return (
        <Pill tone="neutral" size="sm">
          差替済
        </Pill>
      )
  }
}
