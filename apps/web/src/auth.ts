import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authorizeCredentials } from '@/lib/credentials-authorize'
import { nodeJwtCallback } from '@/lib/node-jwt-callback'
import { authConfig } from './auth.config'

/**
 * Full NextAuth instance for the Node runtime. Layers the Credentials
 * provider on top of the edge-safe `authConfig` and wraps its jwt callback
 * with a Node-only DB revalidation step to invalidate deactivated users'
 * sessions. Middleware re-creates a NextAuth instance from `authConfig`
 * alone — it stays DB-free and so may allow one request through, but the
 * next Node render (Server Component / Action) will reject a revoked
 * session and redirect to /login.
 */
const baseCallbacks = authConfig.callbacks ?? {}
const baseJwt = baseCallbacks.jwt

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        username: { label: 'ユーザー名', type: 'text' },
        password: { label: 'パスワード', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    ...baseCallbacks,
    jwt: async (params) => {
      if (!baseJwt) return params.token
      return nodeJwtCallback(
        params as Parameters<typeof nodeJwtCallback>[0],
        baseJwt as Parameters<typeof nodeJwtCallback>[1],
      )
    },
  },
})
