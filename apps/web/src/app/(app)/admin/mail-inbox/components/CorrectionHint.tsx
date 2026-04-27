import Link from 'next/link'
import { Card, Pill } from '@/components/ui'

export interface CorrectionHintProps {
  isCorrection: boolean
  referencesSubject: string | null
  relatedDrafts: Array<{
    id: number
    subject: string | null
    eventId: number | null
  }>
  relatedEvents: Array<{
    id: number
    title: string
    eventDate: string | null
  }>
}

/**
 * Banner shown on the draft detail page when the AI flagged the mail as a
 * correction (`is_correction`) or when Phase 5's loader found candidate
 * earlier drafts/events that look related. Renders nothing when none of
 * those signals are present so the parent can drop it unconditionally.
 *
 * `isCorrection` is the column-level flag the worker persisted alongside the
 * jsonb payload; it is checked independently of `referencesSubject` so a
 * "correction without a parseable subject" still surfaces a warning to the
 * operator (instead of silently dropping the heads-up).
 *
 * Approved drafts are still listed but visually distinguished by an
 * `events #N` pill so an admin can jump straight to the published event
 * without re-following the draft chain.
 */
export function CorrectionHint({
  isCorrection,
  referencesSubject,
  relatedDrafts,
  relatedEvents,
}: CorrectionHintProps) {
  if (
    !isCorrection &&
    referencesSubject === null &&
    relatedDrafts.length === 0 &&
    relatedEvents.length === 0
  ) {
    return null
  }

  return (
    <Card className="border-warn-fg/30 bg-warn-bg">
      <div className="space-y-2 text-sm">
        <div className="font-semibold text-warn-fg">⚠ 訂正版の可能性</div>

        {referencesSubject ? (
          <div className="text-ink-2">
            AI が「{referencesSubject}」への訂正と判断しました。
          </div>
        ) : (
          isCorrection && (
            <div className="text-ink-2">
              AI が訂正版と判断しましたが、参照件名は取得できませんでした。
            </div>
          )
        )}

        {relatedDrafts.length > 0 && (
          <div>
            <div className="text-xs font-medium text-ink-meta">
              関連ドラフト
            </div>
            <ul className="mt-1 space-y-1">
              {relatedDrafts.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-1.5 text-xs"
                >
                  <Link
                    href={`/admin/mail-inbox/${d.id}`}
                    className="text-brand-fg underline"
                  >
                    {d.subject ?? '(件名なし)'}
                  </Link>
                  {d.eventId !== null && (
                    <Pill tone="success" size="sm">
                      events #{d.eventId}
                    </Pill>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {relatedEvents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-ink-meta">
              関連イベント
            </div>
            <ul className="mt-1 space-y-1">
              {relatedEvents.map((e) => (
                <li key={e.id} className="text-xs">
                  <Link
                    href={`/events/${e.id}`}
                    className="text-brand-fg underline"
                  >
                    {e.title}
                    {e.eventDate && ` (${e.eventDate})`}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
