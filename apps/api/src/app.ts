import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { eventsRoute } from './routes/events'

// basePath は dev/prod 一貫で '/hono-api'。Next.js (apps/web) の Auth.js (/api/auth/*) や line-link (/api/line-link/*) との path 衝突を回避するため、Hono は別 prefix を持つ。本番 nginx は /hono-api/* を api 3001 に振り分ける (docker/nginx/kagetra.conf.example 参照)。
const app = new Hono().basePath('/hono-api')

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
