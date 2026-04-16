import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { eventGroups } from '@kagetra/shared/schema'

const createGroupSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional(),
})

const updateGroupSchema = createGroupSchema.partial()

const route = new Hono()
  .get('/', async (c) => {
    const groups = await db.query.eventGroups.findMany({
      orderBy: (groups, { asc }) => [asc(groups.name)],
    })
    return c.json(groups)
  })
  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const group = await db.query.eventGroups.findFirst({
      where: eq(eventGroups.id, id),
      with: { events: true },
    })
    if (!group) return c.json({ error: 'Not found' }, 404)
    return c.json(group)
  })
  .post('/', zValidator('json', createGroupSchema), async (c) => {
    const body = c.req.valid('json')
    const [created] = await db.insert(eventGroups).values(body).returning()
    return c.json(created, 201)
  })
  .put('/:id', zValidator('json', updateGroupSchema), async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(eventGroups)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(eventGroups.id, id))
      .returning()
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const [deleted] = await db
      .delete(eventGroups)
      .where(eq(eventGroups.id, id))
      .returning()
    if (!deleted) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  })

export { route as eventGroupsRoute }
