import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { resolveEditionFromForm } from '@/lib/edition/resolve'
import { EventForm } from '@/components/events/event-form'

export default async function NewEventPage() {
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

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

    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(g => formData.get(`grade_${g}`) === 'on')
    const editionYear =
      data.eventDate && /^\d{4}-/.test(data.eventDate) ? Number(data.eventDate.slice(0, 4)) : null

    // tournament-entry-rosters (Codex R6): 手動作成でも開催(edition) に紐付けられる。
    // edition 解決(系列の find-or-create)と events 挿入を 1 tx で。redirect は tx 外。
    const created = await db.transaction(async (tx) => {
      const editionId = await resolveEditionFromForm(tx, formData, {
        kind: data.kind,
        year: editionYear,
        status: 'unconfirmed',
      })
      const result = await tx
        .insert(events)
        .values({
          ...data,
          createdBy: session.user.id,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          editionId,
        })
        .returning({ id: events.id })
      return result[0]!
    })
    redirect(`/events/${created.id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント作成</h1>
      <EventForm
        mode="create"
        action={createEvent}
        cancelHref="/events"
      />
    </div>
  )
}
