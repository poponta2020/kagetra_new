import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { eventGroups } from '@kagetra/shared/schema'

// Read-only. Write endpoints are intentionally not exposed until the Hono auth
// middleware is designed in Phase 1-V. The web app manages event groups via
// Server Actions with session-based auth.
const route = new Hono()
  .get('/', async (c) => {
    const groups = await db.query.eventGroups.findMany({
      orderBy: (groups, { asc }) => [asc(groups.name)],
    })
    return c.json(groups)
  })
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400)
    const group = await db.query.eventGroups.findFirst({
      where: eq(eventGroups.id, id),
      with: { events: true },
    })
    if (!group) return c.json({ error: 'Not found' }, 404)
    return c.json(group)
  })

export { route as eventGroupsRoute }
