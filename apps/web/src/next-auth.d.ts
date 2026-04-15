import 'next-auth'
import '@auth/core/types'
import '@auth/core/adapters'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'admin' | 'vice_admin' | 'member'
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module '@auth/core/types' {
  interface User {
    role?: 'admin' | 'vice_admin' | 'member'
    isInvited?: boolean
  }
}

declare module '@auth/core/adapters' {
  interface AdapterUser {
    role?: 'admin' | 'vice_admin' | 'member'
    isInvited?: boolean
  }
}
