'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events, eventAttendances, users } from '@kagetra/shared/schema'

export async function submitAttendance(eventId: number, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const isAdminUser =
    session.user.role === 'admin' || session.user.role === 'vice_admin'

  const attend = formData.get('attend') === 'true'
  const comment = (formData.get('comment') as string) || null

  const [targetEvent, currentUser] = await Promise.all([
    db.query.events.findFirst({ where: eq(events.id, eventId) }),
    db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
  ])
  if (!targetEvent) throw new Error('Event not found')

  const todayJst = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tokyo',
  })
  if (!isAdminUser && !currentUser?.isInvited) {
    throw new Error('出欠回答の対象外です')
  }
  if (
    !isAdminUser &&
    targetEvent.internalDeadline &&
    targetEvent.internalDeadline < todayJst
  ) {
    throw new Error('会内締切を過ぎています')
  }
  if (
    !isAdminUser &&
    targetEvent.eligibleGrades?.length &&
    (!currentUser?.grade ||
      !targetEvent.eligibleGrades.includes(currentUser.grade))
  ) {
    throw new Error('対象外の級です')
  }

  await db
    .insert(eventAttendances)
    .values({ eventId, userId: session.user.id, attend, comment })
    .onConflictDoUpdate({
      target: [eventAttendances.eventId, eventAttendances.userId],
      set: { attend, comment, updatedAt: new Date() },
    })

  revalidatePath(`/events/${eventId}`)
}
