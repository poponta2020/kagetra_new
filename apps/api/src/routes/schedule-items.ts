import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { scheduleItems } from '@kagetra/shared/schema'

const createScheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['practice', 'meeting', 'social', 'other']).optional(),
  name: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const updateScheduleSchema = createScheduleSchema.partial()

const route = new Hono()
  .get('/', async (c) => {
    const items = await db.query.scheduleItems.findMany({
      orderBy: [desc(scheduleItems.date)],
    })
    return c.json(items)
  })
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const item = await db.query.scheduleItems.findFirst({
      where: eq(scheduleItems.id, id),
    })
    if (!item) return c.json({ error: 'Not found' }, 404)
    return c.json(item)
  })
  .post('/', zValidator('json', createScheduleSchema), async (c) => {
    const body = c.req.valid('json')
    const ownerId = c.req.header('x-user-id')
    const [created] = await db
      .insert(scheduleItems)
      .values({ ...body, ownerId: ownerId ?? null })
      .returning()
    return c.json(created, 201)
  })
  .put('/:id', zValidator('json', updateScheduleSchema), async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(scheduleItems)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(scheduleItems.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const [deleted] = await db
      .delete(scheduleItems)
      .where(eq(scheduleItems.id, id))
      .returning()
    if (!deleted) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  })

export { route as scheduleItemsRoute }
