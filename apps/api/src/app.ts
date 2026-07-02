import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

// basePath は dev/prod 一貫で '/hono-api'。Next.js (apps/web) の Auth.js (/api/auth/*) や line-link (/api/line-link/*) との path 衝突を回避するため、Hono は別 prefix を持つ。本番 nginx は /hono-api/* を api 3001 に振り分ける (docker/nginx/kagetra.conf.example 参照)。
const app = new Hono().basePath('/hono-api')

app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
}))

// SECURITY: Hono API はまだ認証ミドルウェアを持たない。nginx は /hono-api/* を
// Next.js middleware を経由せず直接この API に proxy_pass するため、ここに
// データルートを生やすと LINE ログイン（Auth.js + middleware）を完全に迂回した
// 無認証アクセスになる。実際に /events の CRUD が無認証で外部公開されていた
// (誰でも GET/POST/PUT/DELETE 可能) ため撤去した。フロント (apps/web) はすべて
// Server Actions で DB を直接操作しており、この API を呼んでいない
// (apps/web/src/lib/api.ts の apiClient は呼び出し元ゼロ) ので影響はない。
//
// 今後ここにルートを追加する場合は、先に Auth.js JWT を検証する認証
// ミドルウェアを噛ませ、role ゲートを通すこと。それまでは /health のみ公開する。
const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))

export type AppType = typeof routes
export { app }
