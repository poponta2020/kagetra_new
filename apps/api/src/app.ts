import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { eventsRoute } from './routes/events'

const app = new Hono().basePath('/api')

app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
}))

// Phase 1-4 で追加予定だった /event-groups, /schedule-items, /attendances の
// 各ルートは、Hono 認証ミドルウェアが未実装のため Phase 1-V で認証設計と合わせて
// 再実装する。現状フロントは Server Actions で DB 直接操作しているため影響なし。
const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/events', eventsRoute)

export type AppType = typeof routes
export { app }
