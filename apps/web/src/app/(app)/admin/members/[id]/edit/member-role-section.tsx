'use client'

import { useActionState, useState } from 'react'
import { roleViewLabel, type UserRole } from '@/lib/role-preview'
import { updateMemberRole, type UpdateRoleState } from './actions'

const initialState: UpdateRoleState = {}

/** 上位 → 下位。設定シートの並びと同じ順。 */
const ROLES: readonly UserRole[] = ['admin', 'vice_admin', 'member']

function isPrivileged(role: UserRole): boolean {
  return role === 'admin' || role === 'vice_admin'
}

/**
 * ロール変更セクション（member-role-management）。
 *
 * 呼び出し側（page.tsx）が admin にしか描画しない前提だが、拒否条件は
 * すべて Server Action 側にも同じものがある — ここでの無効化は誤操作を
 * 減らすための案内であって、認可そのものではない。
 */
export function MemberRoleSection({
  userId,
  memberName,
  currentRole,
  isSelf,
  lineLinked,
  deactivated,
}: {
  userId: string
  memberName: string
  currentRole: UserRole
  isSelf: boolean
  lineLinked: boolean
  deactivated: boolean
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberRole,
    initialState,
  )
  const [selected, setSelected] = useState<UserRole>(currentRole)

  // 昇格（admin / vice_admin へ）だけを塞ぐ理由。降格には及ばない。
  const promotionBlockedReason = !lineLinked
    ? 'LINE 紐付け前の会員は管理者・副管理者にできません。紐付け後に変更してください。'
    : deactivated
      ? '退会済みの会員は管理者・副管理者にできません。一般会員への変更のみできます。'
      : null

  return (
    <section className="rounded-lg bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold">ロール</h3>
      <p className="mt-1 text-sm text-ink-2">
        現在: {roleViewLabel(currentRole)}
      </p>

      {isSelf ? (
        <p className="mt-2 text-xs text-ink-meta">
          ご自身のロールは変更できません。変更が必要な場合は他の管理者に依頼してください。
        </p>
      ) : (
        <>
          {promotionBlockedReason && (
            <p className="mt-2 text-xs text-ink-meta">{promotionBlockedReason}</p>
          )}
          {state.error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="mt-2 text-sm text-success">
              ロールを変更しました。
            </p>
          )}
          <form
            action={formAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `「${memberName}」のロールを${roleViewLabel(selected)}に変更します。よろしいですか？`,
                )
              ) {
                e.preventDefault()
              }
            }}
            className="mt-3 flex items-center gap-2"
          >
            <input type="hidden" name="userId" value={userId} />
            <select
              name="role"
              value={selected}
              onChange={(e) => setSelected(e.target.value as UserRole)}
              aria-label="ロール"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              {ROLES.map((role) => (
                <option
                  key={role}
                  value={role}
                  // 現在のロールは、昇格が塞がれていても選べるままにする
                  // （選択済みの値が disabled だと保存の意味が分からなくなる）。
                  disabled={
                    promotionBlockedReason != null &&
                    isPrivileged(role) &&
                    role !== currentRole
                  }
                >
                  {roleViewLabel(role)}
                </option>
              ))}
            </select>
            {/* hover は opacity ではなく brightness で当てる（DeleteMemberSection
                と同じ理由 — disabled:opacity-60 と property を奪い合わせない）。 */}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink-on-brand hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? '保存中…' : 'ロールを保存'}
            </button>
          </form>
        </>
      )}
    </section>
  )
}
