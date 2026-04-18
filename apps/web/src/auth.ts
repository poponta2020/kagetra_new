import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authorizeCredentials } from '@/lib/credentials-authorize'
import { authConfig } from './auth.config'

/**
 * Full NextAuth instance for the Node runtime. Layers the Credentials
 * provider on top of the edge-safe `authConfig` (which already contains the
 * jwt/session callbacks). Middleware re-creates a NextAuth instance from
 * `authConfig` alone — no providers needed there.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
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
})
