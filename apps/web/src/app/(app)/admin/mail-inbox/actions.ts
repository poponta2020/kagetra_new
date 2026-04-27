'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { eventGroups, events, tournamentDrafts } from '@kagetra/shared/schema'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import {
  classifyMail,
  persistOutcome,
} from '@kagetra/mail-worker/classify/classifier'
import { AnthropicSonnet46Extractor } from '@kagetra/mail-worker/classify/llm/anthropic'
import { loadLlmConfig } from '@kagetra/mail-worker/config'

// Set of statuses still subject to operator action. `approved`, `rejected`,
// and `superseded` are terminal: any further mutation would corrupt review
// history (e.g. linking a rejected draft to an event flips it back to
// approved, re-extracting a superseded draft revives it via persistOutcome).
const APPROVABLE_STATUSES = ['pending_review', 'ai_failed'] as const

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

export async function approveDraft(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const parsed = eventFormSchema.parse(extractEventFormData(formData))

  // Mirror events/new (apps/web/src/app/(app)/events/new/page.tsx) so an
  // approval through the inbox produces the same FK-validated row a manual
  // create would, instead of letting a stale group_id bubble up as a 500.
  if (parsed.eventGroupId != null) {
    const group = await db.query.eventGroups.findFirst({
      where: eq(eventGroups.id, parsed.eventGroupId),
      columns: { id: true },
    })
    if (!group) {
      throw new Error('入力が不正です: 指定された大会グループが存在しません')
    }
  }

  // EventForm renders eligible grades as separate `grade_X` checkboxes which
  // extractEventFormData / eventFormSchema do not cover; collect them here
  // exactly like events/new and events/[id]/edit do.
  const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(
    (g) => formData.get(`grade_${g}`) === 'on',
  )

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(events)
      .values({
        ...parsed,
        eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
        createdBy: session.user.id,
      })
      .returning({ id: events.id })
    const newEventId = inserted[0]?.id
    if (newEventId == null) throw new Error('event insert failed')

    // Status-gated update inside the transaction. Two concurrent approveDraft
    // calls would both insert events, but only one will see a row to update
    // here (the loser blocks on the row lock and then sees status='approved');
    // the loser throws and the speculative event insert rolls back with the
    // transaction. Same guard catches direct API calls against finalized
    // drafts.
    const updated = await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        eventId: newEventId,
        approvedByUserId: session.user.id,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tournamentDrafts.id, draftId),
          inArray(tournamentDrafts.status, APPROVABLE_STATUSES),
        ),
      )
      .returning({ id: tournamentDrafts.id })

    if (updated.length === 0) {
      throw new Error('draft is not approvable')
    }
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath('/events')
}

export async function rejectDraft(draftId: number, formData: FormData) {
  const session = await requireAdminSession()

  const reasonRaw = formData.get('rejection_reason')
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : ''
  if (!reason) throw new Error('却下理由は必須です')

  // event_id is intentionally not touched here: rejection doesn't link to an
  // event, and a previously linked draft being re-rejected keeps its history.
  // Status guard prevents flipping an already-finalized draft (approved /
  // rejected / superseded) via direct call.
  const updated = await db
    .update(tournamentDrafts)
    .set({
      status: 'rejected',
      rejectedByUserId: session.user.id,
      rejectedAt: sql`now()`,
      rejectionReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tournamentDrafts.id, draftId),
        inArray(tournamentDrafts.status, APPROVABLE_STATUSES),
      ),
    )
    .returning({ id: tournamentDrafts.id })

  if (updated.length === 0) {
    throw new Error('draft is not rejectable')
  }

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function reextractDraft(draftId: number) {
  await requireAdminSession()

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: { messageId: true, status: true },
  })
  if (!draft) throw new Error('draft not found')
  // persistOutcome (called below) rewrites status / extracted_payload via
  // UPSERT on message_id, so re-extracting a finalized draft would silently
  // resurrect it for review. Guard at this action layer; the cron-driven
  // worker path doesn't touch already-classified mails.
  if (
    draft.status !== 'pending_review' &&
    draft.status !== 'ai_failed'
  ) {
    throw new Error('draft is not reextractable')
  }

  const cfg = loadLlmConfig()
  const llm = new AnthropicSonnet46Extractor({ apiKey: cfg.anthropicApiKey })
  const outcome = await classifyMail(db, draft.messageId, llm, { force: true })
  await persistOutcome(db, draft.messageId, outcome)

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function linkDraftToEvent(draftId: number, eventId: number) {
  const session = await requireAdminSession()

  const target = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true },
  })
  if (!target) throw new Error('Event not found')

  const updated = await db
    .update(tournamentDrafts)
    .set({
      status: 'approved',
      eventId,
      approvedByUserId: session.user.id,
      approvedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tournamentDrafts.id, draftId),
        inArray(tournamentDrafts.status, APPROVABLE_STATUSES),
      ),
    )
    .returning({ id: tournamentDrafts.id })

  if (updated.length === 0) {
    throw new Error('draft is not linkable')
  }

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath(`/events/${eventId}`)
}
