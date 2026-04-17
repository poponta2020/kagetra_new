import NextAuth from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, accounts, sessions, verificationTokens } from '@kagetra/shared/schema'
import { authConfig } from './auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  callbacks: {
    async signIn({ account, profile }) {
      const lineUserId = profile?.sub as string | undefined
      if (!lineUserId || account?.provider !== 'line') return false
      // Returning user: already has an account linked
      const existingAccount = await db.query.accounts.findFirst({
        where: eq(accounts.providerAccountId, lineUserId),
        columns: { userId: true },
      })
      if (existingAccount) return true
      // New user: check if pre-registered as invited member
      const invitedMember = await db.query.users.findFirst({
        where: eq(users.lineUserId, lineUserId),
        columns: { id: true, isInvited: true },
      })
      if (!invitedMember?.isInvited) return '/auth/not-invited'
      return true
    },
    async session({ session, user }) {
      session.user.id = user.id!
      session.user.role = (user as unknown as { role: string }).role as 'admin' | 'vice_admin' | 'member'
      return session
    },
  },
  events: {
    async linkAccount({ user, account }) {
      // After Auth.js links the LINE account, write lineUserId to the user
      if (account.provider === 'line') {
        await db
          .update(users)
          .set({ lineUserId: account.providerAccountId })
          .where(eq(users.id, user.id!))
      }
    },
  },
})
