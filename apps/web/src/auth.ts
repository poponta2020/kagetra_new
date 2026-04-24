import NextAuth from 'next-auth'
import { eq } from 'drizzle-orm'
import { authConfig } from './auth.config'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { nodeJwtCallback } from '@/lib/node-jwt-callback'

/**
 * Full NextAuth instance for the Node runtime. Inherits the Edge-safe
 * `authConfig` and layers on:
 *   - a `signIn` callback that rejects deactivated users at login time
 *   - a `jwt` callback wrapper that resolves the LINE user ID to our internal
 *     users.id and fills role/lineLinkedAt/lineLinkedMethod from the DB
 *
 * Middleware re-creates a NextAuth instance from `authConfig` alone — it stays
 * DB-free and therefore can only distinguish "has session" from "no session".
 * Any per-user gating (deactivation, /self-identify redirect) flows through the
 * JWT claims set by this file, read by middleware.
 */
const baseCallbacks = authConfig.callbacks ?? {}
const baseJwt = baseCallbacks.jwt

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  callbacks: {
    ...baseCallbacks,
    async signIn({ account }) {
      if (account?.provider !== 'line') return true
      const lineUserId = account.providerAccountId
      if (!lineUserId) return false
      const existing = await db.query.users.findFirst({
        where: eq(users.lineUserId, lineUserId),
        columns: { id: true, deactivatedAt: true },
      })
      // Reject deactivated members at login with a dedicated error code so
      // the SignInPage can show the 退会済み message. Returning `false` here
      // would surface as Auth.js's generic `AccessDenied` instead.
      if (existing?.deactivatedAt) return '/auth/signin?error=deactivated'
      // New LINE user (no match yet) is allowed through; middleware will route
      // them to /self-identify where they claim an invited member row.
      return true
    },
    jwt: async (params) => {
      if (!baseJwt) return params.token
      return nodeJwtCallback(
        params as Parameters<typeof nodeJwtCallback>[0],
        baseJwt as Parameters<typeof nodeJwtCallback>[1],
      )
    },
  },
})
