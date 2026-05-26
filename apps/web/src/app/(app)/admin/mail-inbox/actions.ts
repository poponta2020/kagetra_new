'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  eventGroups,
  events,
  mailMessages,
  mailWorkerJobs,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { broadcastMailToEvent } from '@/lib/line-broadcast'
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

  // Capture the post-commit state for the LINE broadcast trigger so we can
  // schedule it AFTER the response is flushed — without round-tripping a
  // second query.
  let approvedEventId: number | null = null
  let approvedMailMessageId: number | null = null
  let approvedIsCorrection = false

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
      .returning({
        id: tournamentDrafts.id,
        messageId: tournamentDrafts.messageId,
        isCorrection: tournamentDrafts.isCorrection,
      })

    if (updated.length === 0) {
      throw new Error('draft is not approvable')
    }

    approvedEventId = newEventId
    approvedMailMessageId = updated[0]!.messageId
    approvedIsCorrection = updated[0]!.isCorrection

    // Sync mail_messages.status when the draft is finalized so the inbox
    // list filter and the mail-worker re-extract path can rely on a single
    // source of truth for "operator-closed". Without this, drafts approved
    // from an `ai_failed` mail leave the mail row stuck in `ai_failed` and
    // the reextract CLI would (incorrectly) retarget it — see worklog
    // 2026-05-12 session 3 (mail_id=12 orphan).
    await tx
      .update(mailMessages)
      .set({ status: 'archived', updatedAt: sql`now()` })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath('/events')

  // event-line-broadcast: trigger after the response is flushed so the
  // operator's UI returns immediately — pdftoppm / libreoffice can take
  // tens of seconds on a beefy mail and would otherwise block the redirect.
  // `broadcastMailToEvent` is best-effort: failures are recorded into
  // event_broadcast_messages without affecting the approval.
  if (approvedEventId != null && approvedMailMessageId != null) {
    const eventId = approvedEventId
    const mailMessageId = approvedMailMessageId
    const isCorrection = approvedIsCorrection
    after(async () => {
      try {
        await broadcastMailToEvent(db, { eventId, mailMessageId, isCorrection })
      } catch (err) {
        console.error('[approveDraft] broadcastMailToEvent failed', err)
      }
    })
  }
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
  await db.transaction(async (tx) => {
    const updated = await tx
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
      .returning({
        id: tournamentDrafts.id,
        messageId: tournamentDrafts.messageId,
      })

    if (updated.length === 0) {
      throw new Error('draft is not rejectable')
    }

    // Sync mail_messages.status — see approveDraft for rationale.
    await tx
      .update(mailMessages)
      .set({ status: 'archived', updatedAt: sql`now()` })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

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

  await db.transaction(async (tx) => {
    const updated = await tx
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
      .returning({
        id: tournamentDrafts.id,
        messageId: tournamentDrafts.messageId,
      })

    if (updated.length === 0) {
      throw new Error('draft is not linkable')
    }

    // Sync mail_messages.status — see approveDraft for rationale.
    await tx
      .update(mailMessages)
      .set({ status: 'archived', updatedAt: sql`now()` })
      .where(eq(mailMessages.id, updated[0]!.messageId))
  })

  revalidatePath('/admin/mail-inbox')
  revalidatePath(`/admin/mail-inbox/${draftId}`)
  revalidatePath(`/events/${eventId}`)
}

// PR5 Phase 4a — manual mail-fetch job queue.
//
// The Server Action is INSERT-only into `mail_worker_jobs`; the systemd-timer
// driven mail-worker dispatcher claims the row via FOR UPDATE SKIP LOCKED on
// its next tick (~30 min). UI feedback is therefore "ジョブ #N を予約しました"
// only — no progress polling in v1 (deferred per pr5-plan.md).
const PRESET_VALUES = ['24h', '3d', '7d', 'custom'] as const
const triggerMailFetchSchema = z
  .object({
    preset: z.enum(PRESET_VALUES),
    // YYYY-MM-DD only when preset='custom'. The regex enforces the shape so
    // computeSince()'s `${customDate}T00:00:00+09:00` template can never
    // produce an Invalid Date silently.
    customDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'customDate は YYYY-MM-DD 形式')
      .optional(),
  })
  .refine(
    (v) => v.preset !== 'custom' || !!v.customDate,
    { message: 'preset=custom のとき customDate が必須', path: ['customDate'] },
  )

/**
 * Compute the `since` timestamp from the form preset.
 *
 *   '24h'    → now - 24 hours
 *   '3d'     → now - 3 days
 *   '7d'     → now - 7 days
 *   'custom' → JST 0:00 of the given YYYY-MM-DD
 *
 * JST round-trip mirrors `apps/mail-worker/src/cli-args.ts`'s `parseSinceArg`
 * — bare `new Date('2026-04-12')` would resolve to UTC midnight (= 09:00 JST)
 * and silently drop mails received between 00:00 and 08:59 JST that day.
 * Mail-worker's exports map does not surface `cli-args`, so we keep the
 * computation duplicated here rather than widening the package surface.
 */
function computeSince(input: { preset: (typeof PRESET_VALUES)[number]; customDate?: string }): Date {
  const now = Date.now()
  switch (input.preset) {
    case '24h':
      return new Date(now - 24 * 3600 * 1000)
    case '3d':
      return new Date(now - 3 * 24 * 3600 * 1000)
    case '7d':
      return new Date(now - 7 * 24 * 3600 * 1000)
    case 'custom': {
      // refine() above guarantees customDate is set when preset='custom',
      // but TypeScript narrowing through the discriminated union on a single
      // optional field needs the explicit guard.
      if (!input.customDate) {
        throw new Error('customDate required for preset=custom')
      }
      const d = new Date(`${input.customDate}T00:00:00+09:00`)
      if (Number.isNaN(d.getTime())) {
        throw new Error(`invalid customDate: ${input.customDate}`)
      }
      return d
    }
  }
}

export async function triggerMailFetch(
  formData: FormData,
): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
  // Authorization throws (Unauthorized / Forbidden) so unauthenticated /
  // member callers never reach the validate path; callers can rely on the
  // throw for the authn/authz gate just like the other actions in this file.
  const session = await requireAdminSession()

  const raw = {
    preset: formData.get('preset'),
    // FormData.get returns FormDataEntryValue | null; z.string() rejects
    // anything but string so a missing field surfaces as invalid form input.
    customDate: formData.get('customDate') ?? undefined,
  }
  const parsed = triggerMailFetchSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'invalid form input' }
  }

  let since: Date
  try {
    since = computeSince(parsed.data)
  } catch {
    return { ok: false, error: 'invalid form input' }
  }

  // Future-dated `since` makes no semantic sense (the IMAP fetch would return
  // zero rows and waste a worker cycle). Cheaper to refuse here than to let
  // the dispatcher discover it.
  if (since.getTime() > Date.now()) {
    return { ok: false, error: 'since が未来日付です' }
  }

  const inserted = await db
    .insert(mailWorkerJobs)
    .values({
      requestedByUserId: session.user.id,
      since,
      status: 'pending',
    })
    .returning({ id: mailWorkerJobs.id })
  const job = inserted[0]
  if (!job) throw new Error('mail_worker_jobs insert failed')

  revalidatePath('/admin/mail-inbox')
  return { ok: true, jobId: job.id }
}
