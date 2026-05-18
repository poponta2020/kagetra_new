import { hc } from 'hono/client'
import type { AppType } from '@kagetra/api/types'

// baseUrl は dev/prod 共通で '/hono-api' (相対 path)。dev は next.config.ts の rewrites が /hono-api/* を http://localhost:3001/hono-api/* に転送、prod は nginx が同じ path を api 3001 に proxy_pass する。NEXT_PUBLIC_API_URL env で上書き可。
export const apiClient = hc<AppType>(
  process.env.NEXT_PUBLIC_API_URL ?? '/hono-api'
)
