import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { eventAttendances } from '@kagetra/shared/schema'

// Read-only. Write endpoints (upsert, admin override) are intentionally not
// exposed until the Hono auth middleware is designed in Phase 1-V. The web app
// writes attendances via Server Actions with session-based auth.
const route = new Hono()
  // GET /attendances/:eventId — list attendees for an event (minimal user fields)
  .get('/:eventId', async (c) => {
    const eventId = Number(c.req.param('eventId'))
    if (isNaN(eventId) || eventId <= 0) return c.json({ error: 'Invalid eventId' }, 400)

    const attendances = await db.query.eventAttendances.findMany({
      where: eq(eventAttendances.eventId, eventId),
      with: {
        user: {
          columns: { id: true, name: true, grade: true },
        },
      },
    })
    return c.json(attendances)
  })

export { route as attendancesRoute }
