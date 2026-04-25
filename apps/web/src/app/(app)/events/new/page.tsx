import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { events, eventGroups } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { EventForm } from '@/components/events/event-form'

export default async function NewEventPage() {
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  const groups = await db.query.eventGroups.findMany({
    orderBy: (g, { asc }) => [asc(g.name)],
  })

  async function createEvent(formData: FormData) {
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

    // Validate eventGroupId existence before insert to avoid FK exceptions surfacing as 500s.
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

    const result = await db.insert(events).values({
      ...data,
      createdBy: session.user.id,
      eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
    }).returning()

    const created = result[0]!
    redirect(`/events/${created.id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント作成</h1>
      <EventForm
        mode="create"
        action={createEvent}
        groups={groups}
        cancelHref="/events"
      />
    </div>
  )
}
