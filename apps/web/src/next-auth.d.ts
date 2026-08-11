import 'next-auth'
import 'next-auth/jwt'
import '@auth/core/types'
import '@auth/core/adapters'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      /**
       * 実効ロール。通常は本物のロールと同値だが、role-preview-switch で
       * 表示ロールを下げている間は下位ロールになる。UI の出し分けも
       * Server Action / route handler の認可もすべてこれを見る。
       */
      role: 'admin' | 'vice_admin' | 'member' | 'guest'
      /**
       * 本物のロール（DB 上の users.role）。プレビューの開始・終了の認可は
       * **必ずこちらだけ**で判定する。実効ロールで判定するとプレビュー中に
       * 自分を締め出して管理者へ戻れなくなる。
       */
      realRole: 'admin' | 'vice_admin' | 'member' | 'guest'
      lineUserId: string | null
      lineLinkedAt: string | null
      lineLinkedMethod: 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link' | null
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }

  interface User {
    role?: 'admin' | 'vice_admin' | 'member' | 'guest'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link' | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    /** 本物のロール。role-preview-switch でも**絶対に上書きしない**。 */
    role?: 'admin' | 'vice_admin' | 'member' | 'guest'
    /**
     * role-preview-switch のプレビュー先ロール。未設定 / null で非プレビュー。
     * 実効ロールは session コールバックで `role` 以下へ丸められる。
     *
     * ⚠️ guest-role: **`'guest'` は意図的に含めない**。型がランタイムの防御
     * （`selectableRoles` にゲストを入れない・`resolveEffectiveRole` が
     * `view === 'guest'` を弾く）と同じ形をしているべきなので、ゲストビューへ
     * 切り替えられる余地を型の上でも作らない（requirements R7 / AC-36）。
     */
    viewAsRole?: 'admin' | 'vice_admin' | 'member' | null
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link' | null
  }
}

declare module '@auth/core/types' {
  interface User {
    role?: 'admin' | 'vice_admin' | 'member' | 'guest'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link' | null
  }
}

declare module '@auth/core/adapters' {
  interface AdapterUser {
    role?: 'admin' | 'vice_admin' | 'member' | 'guest'
    isInvited?: boolean
    lineUserId?: string | null
    lineLinkedAt?: string | null
    lineLinkedMethod?: 'self_identify' | 'admin_link' | 'account_switch' | 'invite_link' | null
  }
}
