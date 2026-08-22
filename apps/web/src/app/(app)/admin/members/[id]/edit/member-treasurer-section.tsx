'use client'

import { useActionState, useState } from 'react'
import { updateMemberTreasurer, type UpdateTreasurerState } from './actions'

const initialState: UpdateTreasurerState = {}

/**
 * 会計フラグ（line-bot-message-revamp §3.1.2）。
 *
 * ロール選択の直下に置く。**ロールとは別セクションにしてある**のは、
 * ロール変更が admin 限定なのに対し、会計フラグは会員編集の既存ガードどおり
 * admin / vice_admin が更新できるため（MemberRoleSection ごと副管理者へ
 * 開くとロール変更まで開いてしまう）。
 *
 * この列は「@会計 で誰をメンションするか」の識別**専用**で、権限は付かない。
 * 会計担当には別途ロールとして副管理者を付与して運用する。
 */
export function MemberTreasurerSection({
  userId,
  isTreasurer,
}: {
  userId: string
  isTreasurer: boolean
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberTreasurer,
    initialState,
  )
  const [checked, setChecked] = useState(isTreasurer)

  return (
    <section className="rounded-lg bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold">会計</h3>
      <p className="mt-1 text-xs text-ink-2">
        大会グループへの振込連絡で <code>@会計</code> のメンション対象になります。
        権限は変わりません（操作権限が必要な場合はロールを副管理者にしてください）。
      </p>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-2 text-sm text-success">
          会計の設定を保存しました。
        </p>
      )}
      <form action={formAction} className="mt-3 flex items-center gap-3">
        <input type="hidden" name="userId" value={userId} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isTreasurer"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="size-4 rounded border-border"
          />
          会計担当にする
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink-on-brand hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? '保存中…' : '会計を保存'}
        </button>
      </form>
    </section>
  )
}
