import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { events, eventGroups } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
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
  })

  if (!event) notFound()

  const groups = await db.query.eventGroups.findMany({
    orderBy: (g, { asc }) => [asc(g.name)],
  })

  const eventId = event.id

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

    // Validate eventGroupId existence before update to avoid FK exceptions surfacing as 500s.
    if (data.eventGroupId != null) {
      const group = await db.query.eventGroups.findFirst({
        where: eq(eventGroups.id, data.eventGroupId),
        columns: { id: true },
      })
      if (!group) {
        throw new Error('入力が不正です: 指定された大会グループが存在しません')
      }
    }

    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(g => formData.get(`grade_${g}`) === 'on')

    await db.update(events).set({
      ...data,
      eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
      updatedAt: new Date(),
    }).where(eq(events.id, eventId))

    redirect(`/events/${eventId}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント編集</h1>
      <EventForm
        mode="edit"
        action={updateEvent}
        groups={groups}
        cancelHref={`/events/${event.id}`}
        defaultValues={{
          title: event.title,
          formalName: event.formalName,
          official: event.official,
          kind: event.kind,
          eventDate: event.eventDate,
          startTime: event.startTime,
          endTime: event.endTime,
          location: event.location,
          capacity: event.capacity,
          entryDeadline: event.entryDeadline,
          internalDeadline: event.internalDeadline,
          eventGroupId: event.eventGroupId,
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
