import type { ExtractionPayload } from '@kagetra/mail-worker/classify/schema'
import { EventForm } from '@/components/events/event-form'

export interface ApprovalFormProps {
  extractedPayload: ExtractionPayload | null
  groups: { id: number; name: string }[]
  action: (formData: FormData) => void | Promise<void>
}

/**
 * Pre-fills {@link EventForm} with the AI's extracted_payload so an admin
 * can review and submit the row as a real `events` insert. Pure mapping +
 * passthrough — submission goes to the parent-supplied `action`
 * (`approveDraft.bind(null, draftId)` in Phase 5).
 *
 * `null`-safe: every field is forwarded as `null` when the AI returned no
 * value, which {@link EventForm} already coalesces to `''` for the input
 * `defaultValue`. `kind`/`official` get the EventForm defaults so a missing
 * AI value doesn't render an empty hidden input or unchecked box surprise.
 */
export function ApprovalForm({
  extractedPayload,
  groups,
  action,
}: ApprovalFormProps) {
  const extracted = extractedPayload?.extracted ?? null

  return (
    <EventForm
      mode="create"
      action={action}
      groups={groups}
      cancelHref="/admin/mail-inbox"
      defaultValues={{
        title: extracted?.title ?? null,
        formalName: extracted?.formal_name ?? null,
        eventDate: extracted?.event_date ?? null,
        location: extracted?.venue ?? null,
        feeJpy: extracted?.fee_jpy ?? null,
        paymentDeadline: extracted?.payment_deadline ?? null,
        paymentInfo: extracted?.payment_info_text ?? null,
        paymentMethod: extracted?.payment_method ?? null,
        entryMethod: extracted?.entry_method ?? null,
        organizer: extracted?.organizer_text ?? null,
        entryDeadline: extracted?.entry_deadline ?? null,
        eligibleGrades: extracted?.eligible_grades ?? null,
        kind: extracted?.kind ?? 'individual',
        capacity: extracted?.capacity_total ?? null,
        capacityA: extracted?.capacity_a ?? null,
        capacityB: extracted?.capacity_b ?? null,
        capacityC: extracted?.capacity_c ?? null,
        capacityD: extracted?.capacity_d ?? null,
        capacityE: extracted?.capacity_e ?? null,
        official: extracted?.official ?? true,
      }}
    />
  )
}
