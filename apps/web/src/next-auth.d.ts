import 'next-auth'
import 'next-auth/jwt'
import '@auth/core/types'
import '@auth/core/adapters'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'admin' | 'vice_admin' | 'member'
      mustChangePassword: boolean
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }

  interface User {
    role?: 'admin' | 'vice_admin' | 'member'
    mustChangePassword?: boolean
    isInvited?: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: 'admin' | 'vice_admin' | 'member'
    mustChangePassword?: boolean
  }
}

declare module '@auth/core/types' {
  interface User {
    role?: 'admin' | 'vice_admin' | 'member'
    mustChangePassword?: boolean
    isInvited?: boolean
  }
}

declare module '@auth/core/adapters' {
  interface AdapterUser {
    role?: 'admin' | 'vice_admin' | 'member'
    mustChangePassword?: boolean
    isInvited?: boolean
  }
}
