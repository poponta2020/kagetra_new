import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { eventAttendances, events } from '@kagetra/shared/schema'

const upsertAttendanceSchema = z.object({
  attend: z.boolean(),
  comment: z.string().max(200).optional(),
})

const route = new Hono()
  // GET /attendances/:eventId — list attendees for an event (with user info)
  .get('/:eventId', async (c) => {
    const eventId = Number(c.req.param('eventId'))
    if (isNaN(eventId)) return c.json({ error: 'Invalid eventId' }, 400)

    const attendances = await db.query.eventAttendances.findMany({
      where: eq(eventAttendances.eventId, eventId),
      with: { user: true },
    })
    return c.json(attendances)
  })
  // POST /attendances/:eventId — upsert attendance (register or update)
  // Business logic: check internalDeadline before allowing member changes
  .post('/:eventId', zValidator('json', upsertAttendanceSchema), async (c) => {
    const eventId = Number(c.req.param('eventId'))
    if (isNaN(eventId)) return c.json({ error: 'Invalid eventId' }, 400)

    const body = c.req.valid('json')
    // For now, userId comes from header (auth middleware will be added later)
    const userId = c.req.header('x-user-id')
    if (!userId) return c.json({ error: 'User ID required' }, 401)

    // Check event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    })
    if (!event) return c.json({ error: 'Event not found' }, 404)

    // Check internal deadline
    if (event.internalDeadline) {
      const deadline = new Date(event.internalDeadline)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (today > deadline) {
        return c.json({ error: 'Internal deadline has passed' }, 403)
      }
    }

    // Upsert: insert or update on conflict
    const [result] = await db
      .insert(eventAttendances)
      .values({
        eventId,
        userId,
        attend: body.attend,
        comment: body.comment ?? null,
      })
      .onConflictDoUpdate({
        target: [eventAttendances.eventId, eventAttendances.userId],
        set: {
          attend: body.attend,
          comment: body.comment ?? null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return c.json(result, 201)
  })
  // PUT /attendances/:eventId/:userId — admin update (bypasses deadline)
  .put('/:eventId/:userId', zValidator('json', upsertAttendanceSchema), async (c) => {
    const eventId = Number(c.req.param('eventId'))
    const userId = c.req.param('userId')
    if (isNaN(eventId)) return c.json({ error: 'Invalid eventId' }, 400)

    const body = c.req.valid('json')

    const [result] = await db
      .insert(eventAttendances)
      .values({
        eventId,
        userId,
        attend: body.attend,
        comment: body.comment ?? null,
      })
      .onConflictDoUpdate({
        target: [eventAttendances.eventId, eventAttendances.userId],
        set: {
          attend: body.attend,
          comment: body.comment ?? null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return c.json(result)
  })

export { route as attendancesRoute }
