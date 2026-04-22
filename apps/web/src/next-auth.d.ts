import 'next-auth'
import 'next-auth/jwt'
import '@auth/core/types'
import '@auth/core/adapters'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'admin' | 'vice_admin' | 'member'
      lineUserId: string | null
      lineLinkedAt: string | null
      lineLinkedMethod: 'self_identify' | 'admin_link' | 'account_switch' | null
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }

  interface User {
    role?: 'admin' | 'vice_admin' | 'member'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: 'admin' | 'vice_admin' | 'member'
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | null
  }
}

declare module '@auth/core/types' {
  interface User {
    role?: 'admin' | 'vice_admin' | 'member'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | null
  }
}

declare module '@auth/core/adapters' {
  interface AdapterUser {
    role?: 'admin' | 'vice_admin' | 'member'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | null
  }
}
