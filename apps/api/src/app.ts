import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { eventsRoute } from './routes/events'

const app = new Hono().basePath('/api')

app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
}))

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/events', eventsRoute)

export type AppType = typeof routes
export { app }
