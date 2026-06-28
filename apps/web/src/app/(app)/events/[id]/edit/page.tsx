import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { resolveEditionFromForm } from '@/lib/edition/resolve'
import { EventForm } from '@/components/events/event-form'

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, idNum),
    // tournament-entry-rosters (Codex R6): 現在の開催(edition) 紐付けを編集フォームに pre-fill。
    with: { edition: { with: { series: true } } },
  })

  if (!event) notFound()

  const eventId = event.id
  const editionDefault = event.edition
    ? {
        seriesName: event.edition.series?.name ?? '',
        editionNumber: event.edition.editionNumber,
        linked: true,
      }
    : { seriesName: '', editionNumber: null, linked: false }

  async function updateEvent(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
      throw new Error('Unauthorized')
    }

    const parsed = eventFormSchema.safeParse(extractEventFormData(formData))
    if (!parsed.success) {
      throw new Error(`入力が不正です: ${parsed.error.issues[0]?.message ?? ''}`)
    }
    const data = parsed.data

    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(g => formData.get(`grade_${g}`) === 'on')
    const editionYear =
      data.eventDate && /^\d{4}-/.test(data.eventDate) ? Number(data.eventDate.slice(0, 4)) : null

    // tournament-entry-rosters (Codex R6): edition 紐付けを解決して更新（link OFF なら null=解除）。
    await db.transaction(async (tx) => {
      const editionId = await resolveEditionFromForm(tx, formData, {
        kind: data.kind,
        year: editionYear,
        status: 'unconfirmed',
      })
      await tx
        .update(events)
        .set({
          ...data,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          editionId,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId))
    })

    redirect(`/events/${eventId}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント編集</h1>
      <EventForm
        mode="edit"
        action={updateEvent}
        cancelHref={`/events/${event.id}`}
        editionDefault={editionDefault}
        defaultValues={{
          title: event.title,
          formalName: event.formalName,
          official: event.official,
          kind: event.kind,
          eventDate: event.eventDate,
          location: event.location,
          capacity: event.capacity,
          entryDeadline: event.entryDeadline,
          internalDeadline: event.internalDeadline,
          lotteryDate: event.lotteryDate,
          eligibleGrades: event.eligibleGrades,
          description: event.description,
          status: event.status,
          feeJpy: event.feeJpy,
          paymentDeadline: event.paymentDeadline,
          paymentInfo: event.paymentInfo,
          paymentMethod: event.paymentMethod,
          entryMethod: event.entryMethod,
          organizer: event.organizer,
          capacityA: event.capacityA,
          capacityB: event.capacityB,
          capacityC: event.capacityC,
          capacityD: event.capacityD,
          capacityE: event.capacityE,
        }}
      />
    </div>
  )
}
