import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, desc, eq, gte, ilike, ne, or, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  events,
  eventGroups,
  mailMessages,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import type { ExtractionPayload } from '@kagetra/mail-worker/classify/schema'
import { Card, Pill, type PillTone } from '@/components/ui'
import { AttachmentList } from '../components/AttachmentList'
import { ApprovalForm } from '../components/ApprovalForm'
import { ExtractedPayloadView } from '../components/ExtractedPayloadView'
import { CorrectionHint } from '../components/CorrectionHint'
import {
  approveDraft,
  linkDraftToEvent,
  reextractDraft,
  rejectDraft,
} from '../actions'

/**
 * /admin/mail-inbox/[id] — draft detail + approval surface (PR4 Phase 5).
 *
 * Server Component. Loads the draft + originating mail (with attachments,
 * minus the bytea data column), the event-groups list for the EventForm
 * dropdown, and — when the AI flagged the mail as a correction — short
 * lookups for related drafts/events so the operator can compare. Renders
 * the four bound Server Actions (approve / reject / re-extract / link)
 * inline; the page itself owns no client state.
 *
 * Status guard mirrors the action layer (APPROVABLE_STATUSES in
 * actions.ts): only pending_review / ai_failed render operator buttons.
 * approved / rejected / superseded all collapse to a read-only view with
 * no approve / reject / re-extract / link controls — showing buttons that
 * would always 500 is worse than no buttons at all.
 */
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  pending_review: { label: '承認待ち', tone: 'info' },
  approved: { label: '承認済み', tone: 'success' },
  rejected: { label: '却下', tone: 'neutral' },
  ai_failed: { label: 'AI 失敗', tone: 'danger' },
  superseded: { label: '差替済み', tone: 'neutral' },
}

function formatJst(date: Date): string {
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function MailDraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const draftId = Number(id)
  if (!Number.isInteger(draftId) || draftId <= 0) notFound()

  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // Single round-trip: draft → mail → attachments. The bytea `data` column on
  // mail_attachments is intentionally excluded from the projection so the
  // detail view never drags raw attachment bytes across the wire (the binary
  // route at /api/admin/mail/attachments/{id} streams them on demand).
  const draft = await db.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, draftId),
    with: {
      mail: {
        with: {
          attachments: {
            columns: {
              id: true,
              filename: true,
              contentType: true,
              extractionStatus: true,
            },
          },
        },
      },
    },
  })
  if (!draft || !draft.mail) notFound()

  // Defensive cast mirroring DraftCard: the worker validated this jsonb on
  // insert, so the web layer trusts it without re-running Zod (avoids pulling
  // mail-worker's Zod schema into the Next bundle for a read-only consumer).
  const extractedPayload =
    (draft.extractedPayload as ExtractionPayload | null) ?? null
  const referencesSubject = extractedPayload?.references_subject ?? null

  // Correction lookups — only run when the AI surfaced a referenced subject.
  // 12 mo window, top 3, ILIKE-substring; cheap enough that we can let the
  // planner handle the few thousand row table without a dedicated index.
  let relatedDrafts: Array<{
    id: number
    subject: string | null
    eventId: number | null
  }> = []
  let relatedEvents: Array<{
    id: number
    title: string
    eventDate: string | null
  }> = []
  if (referencesSubject) {
    const pattern = `%${referencesSubject}%`
    relatedDrafts = await db
      .select({
        id: tournamentDrafts.id,
        subject: mailMessages.subject,
        eventId: tournamentDrafts.eventId,
      })
      .from(tournamentDrafts)
      .innerJoin(mailMessages, eq(tournamentDrafts.messageId, mailMessages.id))
      .where(
        and(
          ilike(mailMessages.subject, pattern),
          ne(tournamentDrafts.id, draftId),
          gte(mailMessages.receivedAt, sql`NOW() - INTERVAL '12 months'`),
        ),
      )
      .orderBy(desc(mailMessages.receivedAt))
      .limit(3)

    relatedEvents = await db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
      })
      .from(events)
      .where(
        and(
          or(
            ilike(events.title, pattern),
            ilike(events.formalName, pattern),
          ),
          gte(
            events.eventDate,
            sql`(CURRENT_DATE - INTERVAL '12 months')::date`,
          ),
        ),
      )
      .orderBy(desc(events.eventDate))
      .limit(3)
  }

  // Approval form needs the groups dropdown options (id+name only).
  const groups = await db.query.eventGroups.findMany({
    columns: { id: true, name: true },
    orderBy: (g, { asc }) => [asc(g.name)],
  })

  // Linking-candidate dropdown: recent events (6 mo window) so an admin can
  // attach this draft's mail to an already-published event without paging
  // through the full archive. 100 cap keeps the <select> tractable.
  const eventCandidates = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
    })
    .from(events)
    .where(
      gte(events.eventDate, sql`(CURRENT_DATE - INTERVAL '6 months')::date`),
    )
    .orderBy(desc(events.eventDate))
    .limit(100)

  const status = STATUS_LABEL[draft.status] ?? {
    label: draft.status,
    tone: 'neutral' as const,
  }
  const mail = draft.mail

  // Inline wrappers for actions that don't take FormData directly.
  const reextractAction = async () => {
    'use server'
    await reextractDraft(draftId)
  }
  const linkAction = async (formData: FormData) => {
    'use server'
    const eventIdRaw = formData.get('eventId')
    const eventId = Number(eventIdRaw)
    if (!Number.isInteger(eventId) || eventId <= 0) return
    await linkDraftToEvent(draftId, eventId)
  }

  const isApproved = draft.status === 'approved'
  const isRejected = draft.status === 'rejected'
  const isSuperseded = draft.status === 'superseded'
  // approved / rejected / superseded are terminal at the action layer
  // (see APPROVABLE_STATUSES in actions.ts), so the UI hides every operator
  // button when the draft is in any of those states. Showing a button that
  // would always 500 is worse than no button at all.
  const showApproval = !isApproved && !isRejected && !isSuperseded
  const showReject = showApproval
  const showLink = showApproval
  const showReextract = showApproval

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/admin/mail-inbox"
          className="text-sm text-brand-fg underline"
        >
          ← メール受信箱
        </Link>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-meta">
              {formatJst(mail.receivedAt)}
            </span>
            <Pill tone={status.tone} size="sm">
              {status.label}
            </Pill>
          </div>
          <h1 className="font-display text-lg font-bold text-ink">
            {mail.subject || '(件名なし)'}
          </h1>
          <div className="text-xs text-ink-meta">
            {mail.fromName
              ? `${mail.fromName} <${mail.fromAddress}>`
              : mail.fromAddress}
          </div>
          <AttachmentList items={mail.attachments} />
          {mail.bodyText && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-ink-meta">
                本文プレビュー
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-border-soft bg-surface-alt p-2 text-xs text-ink">
                {mail.bodyText}
              </pre>
            </details>
          )}
        </div>
      </Card>

      {isApproved && draft.eventId !== null && (
        <Card className="border-success-fg/30 bg-success-bg">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-success-fg">承認済み</span>
            <Link
              href={`/events/${draft.eventId}`}
              className="text-brand-fg underline"
            >
              events #{draft.eventId} を開く →
            </Link>
          </div>
        </Card>
      )}

      {isRejected && (
        <Card className="border-border bg-surface-alt">
          <div className="space-y-1 text-sm">
            <div className="font-semibold text-ink">却下済み</div>
            {draft.rejectionReason && (
              <div className="text-ink-2">
                <span className="text-ink-meta">理由:</span>{' '}
                {draft.rejectionReason}
              </div>
            )}
          </div>
        </Card>
      )}

      {isSuperseded && (
        <Card className="border-border bg-surface-alt">
          <div className="text-sm font-semibold text-ink">
            新しい draft で上書きされました
          </div>
        </Card>
      )}

      <CorrectionHint
        referencesSubject={referencesSubject}
        relatedDrafts={relatedDrafts}
        relatedEvents={relatedEvents}
      />

      <ExtractedPayloadView
        payload={extractedPayload}
        confidence={draft.confidence}
        aiModel={draft.aiModel}
        promptVersion={draft.promptVersion}
        aiCostUsd={draft.aiCostUsd}
      />

      {showApproval && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">
            承認フォーム
          </h2>
          <ApprovalForm
            extractedPayload={extractedPayload}
            groups={groups}
            action={approveDraft.bind(null, draftId)}
          />
        </section>
      )}

      {showReject && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">却下</h2>
          <Card>
            <form
              action={rejectDraft.bind(null, draftId)}
              className="flex flex-col gap-2"
            >
              <textarea
                name="rejection_reason"
                required
                placeholder="却下理由（必須）"
                rows={3}
                className="w-full rounded border border-border bg-surface p-2 text-sm text-ink placeholder:text-ink-meta"
              />
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-danger-bg px-4 text-sm font-semibold text-danger-fg hover:opacity-90"
              >
                却下する
              </button>
            </form>
          </Card>
        </section>
      )}

      {showReextract && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">
            再 AI 抽出
          </h2>
          <Card>
            <form action={reextractAction}>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-ink-2 hover:bg-surface-alt"
              >
                再抽出
              </button>
            </form>
          </Card>
        </section>
      )}

      {showLink && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">
            既存 events に紐付ける
          </h2>
          <Card>
            <form action={linkAction} className="flex flex-col gap-2">
              <select
                name="eventId"
                required
                defaultValue=""
                className="w-full rounded border border-border bg-surface p-2 text-sm text-ink"
              >
                <option value="" disabled>
                  --
                </option>
                {eventCandidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} ({e.eventDate ?? '日付未定'})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                紐付ける
              </button>
            </form>
          </Card>
        </section>
      )}
    </div>
  )
}
