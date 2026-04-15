import { hc } from 'hono/client'
import type { AppType } from '@kagetra/api/types'

export const apiClient = hc<AppType>(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
)
