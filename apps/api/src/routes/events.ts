import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { events, eventLineBroadcasts } from '@kagetra/shared/schema'

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'done']).optional(),
  formalName: z.string().max(200).optional(),
  official: z.boolean().optional(),
  kind: z.enum(['individual', 'team']).optional(),
  entryDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  internalDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

    // r-final-12 should_fix: event_line_broadcasts.event_id を ON DELETE
    // RESTRICT にしているため、revoked/released 履歴行が残った event を
    // DELETE すると FK 例外で 500 になる。アプリ層で先に検出し 409 を
    // 返して運用上のメッセージを明確化する。
    const linkedBroadcast = await db
      .select({ id: eventLineBroadcasts.id, status: eventLineBroadcasts.status })
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.eventId, id))
      .limit(1)
    if (linkedBroadcast.length > 0) {
      return c.json(
        {
          error:
            'この大会には LINE 配信履歴が紐付いています。先に履歴を削除するか、削除を控えてください。',
          broadcastStatus: linkedBroadcast[0]!.status,
        },
        409,
      )
    }

    // r-final-21 should_fix: 上の事前チェックと DELETE の間に別 tx が
    // broadcast 行を作るとここで FK 違反 (SQLSTATE 23503) になる。
    // catch して 409 に変換し、500 を露出しない。
    try {
      const [deleted] = await db
        .delete(events)
        .where(eq(events.id, id))
        .returning()
      if (!deleted) return c.json({ error: 'Not found' }, 404)
      return c.json({ success: true })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '23503') {
        return c.json(
          {
            error:
              'この大会には LINE 配信履歴が紐付いています。先に履歴を削除するか、削除を控えてください。',
          },
          409,
        )
      }
      throw err
    }
  })

export { route as eventsRoute }
