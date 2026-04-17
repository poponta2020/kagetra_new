import type { NextAuthConfig } from 'next-auth'
import LINE from 'next-auth/providers/line'

/**
 * Edge-safe auth config: providers + pages only, no DB adapter.
 * Used by middleware (Edge Runtime) which cannot import Node.js `pg`.
 * Full config (with DrizzleAdapter) lives in auth.ts for server use.
 */
export const authConfig = {
  providers: [LINE],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
} satisfies NextAuthConfig
