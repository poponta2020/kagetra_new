import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { eventsRoute } from './routes/events'
import { eventGroupsRoute } from './routes/event-groups'
import { scheduleItemsRoute } from './routes/schedule-items'

const app = new Hono().basePath('/api')

app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
}))

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/events', eventsRoute)
  .route('/event-groups', eventGroupsRoute)
  .route('/schedule-items', scheduleItemsRoute)

export type AppType = typeof routes
export { app }
