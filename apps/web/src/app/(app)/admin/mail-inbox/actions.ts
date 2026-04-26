'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events, tournamentDrafts } from '@kagetra/shared/schema'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import {
  classifyMail,
  persistOutcome,
} from '@kagetra/mail-worker/classify/classifier'
import { AnthropicSonnet46Extractor } from '@kagetra/mail-worker/classify/llm/anthropic'
import { loadLlmConfig } from '@kagetra/mail-worker/config'

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

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: { id: true, status: true },
  })
  if (!draft || (draft.status !== 'pending_review' && draft.status !== 'ai_failed')) {
    throw new Error('draft is not approvable')
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(events)
      .values({ ...parsed, createdBy: session.user.id })
      .returning({ id: events.id })
    const newEventId = inserted[0]?.id
    if (newEventId == null) throw new Error('event insert failed')

    await tx
      .update(tournamentDrafts)
      .set({
        status: 'approved',
        eventId: newEventId,
        approvedByUserId: session.user.id,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tournamentDrafts.id, draftId))
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
  await db
    .update(tournamentDrafts)
    .set({
      status: 'rejected',
      rejectedByUserId: session.user.id,
      rejectedAt: sql`now()`,
      rejectionReason: reason,
      updatedAt: sql`now()`,
    })
    .where(eq(tournamentDrafts.id, draftId))

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
}

export async function reextractDraft(draftId: number) {
  await requireAdminSession()

  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    columns: { messageId: true },
  })
  if (!draft) throw new Error('draft not found')

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

  await db
    .update(tournamentDrafts)
    .set({
      status: 'approved',
      eventId,
      approvedByUserId: session.user.id,
      approvedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tournamentDrafts.id, draftId))

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath(`/events/${eventId}`)
}
