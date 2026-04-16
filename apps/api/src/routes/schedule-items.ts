import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { scheduleItems } from '@kagetra/shared/schema'

// Read-only. Write endpoints are intentionally not exposed until the Hono auth
// middleware is designed in Phase 1-V. The web app manages schedule items via
// Server Actions with session-based auth.
const route = new Hono()
  .get('/', async (c) => {
    const items = await db.query.scheduleItems.findMany({
      orderBy: [desc(scheduleItems.date)],
    })
    return c.json(items)
  })
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400)
    const item = await db.query.scheduleItems.findFirst({
      where: eq(scheduleItems.id, id),
    })
    if (!item) return c.json({ error: 'Not found' }, 404)
    return c.json(item)
  })

export { route as scheduleItemsRoute }
