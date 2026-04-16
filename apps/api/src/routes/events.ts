import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { events } from '@kagetra/shared/schema'

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'done']).optional(),
  formalName: z.string().max(200).optional(),
  official: z.boolean().optional(),
  kind: z.enum(['individual', 'team']).optional(),
  entryDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  internalDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventGroupId: z.number().int().positive().optional(),
  eligibleGrades: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).optional(),
})

const updateEventSchema = createEventSchema.partial()

const route = new Hono()
  .get('/', async (c) => {
    const eventList = await db.query.events.findMany({
      orderBy: [desc(events.eventDate)],
    })
    return c.json(eventList)
  })
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const event = await db.query.events.findFirst({
      where: eq(events.id, id),
      with: { attendances: { with: { user: true } } },
    })
    if (!event) return c.json({ error: 'Not found' }, 404)
    return c.json(event)
  })
  .post('/', zValidator('json', createEventSchema), async (c) => {
    const body = c.req.valid('json')
    const [created] = await db.insert(events).values(body).returning()
    return c.json(created, 201)
  })
  .put('/:id', zValidator('json', updateEventSchema), async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(events)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const [deleted] = await db
      .delete(events)
      .where(eq(events.id, id))
      .returning()
    if (!deleted) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  })

export { route as eventsRoute }
