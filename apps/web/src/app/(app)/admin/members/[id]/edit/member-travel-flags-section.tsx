'use client'

import { useActionState, useState } from 'react'
import { updateMemberTravelFlags, type UpdateTravelFlagsState } from './actions'

const initialState: UpdateTravelFlagsState = {}

/**
 * 副連絡責任者・サークル長のフラグ（travel-report requirements R2）。会計と
 * 同じ「会員編集で admin / vice_admin が付け外しする」形の1セクションだが、
 * ★`isTravelReportSubmitter`（副連絡責任者）は `is_treasurer` と違い
 * **認可に使う**（遠征届の操作権限そのもの）。ゲスト（role='guest'）には
 * チェックボックス自体を出さない — 付与しても
 * `lib/travel-report/authz.ts`（別タスク）が role='guest' を弾くため権限には
 * ならず、サーバー側（updateMemberTravelFlags）でも付与そのものを拒否する。
 */
export function MemberTravelFlagsSection({
  userId,
  role,
  isTravelReportSubmitter,
  isCircleLeader,
}: {
  userId: string
  role: string
  isTravelReportSubmitter: boolean
  isCircleLeader: boolean
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberTravelFlags,
    initialState,
  )
  const [submitterChecked, setSubmitterChecked] = useState(isTravelReportSubmitter)
  const [leaderChecked, setLeaderChecked] = useState(isCircleLeader)
  const isGuest = role === 'guest'

  return (
    <section className="rounded-lg bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold">遠征届の役割</h3>
      <p className="mt-1 text-xs text-ink-2">
        副連絡責任者は遠征届の操作権限そのものです（会計とは異なり権限に使われます）。
        サークル長は同時に1人だけ設定できます。
      </p>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-2 text-sm text-success">
          遠征届の役割を保存しました。
        </p>
      )}
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="userId" value={userId} />
        {!isGuest && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isTravelReportSubmitter"
              checked={submitterChecked}
              onChange={(e) => setSubmitterChecked(e.target.checked)}
              className="size-4 rounded border-border"
            />
            副連絡責任者にする
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isCircleLeader"
            checked={leaderChecked}
            onChange={(e) => setLeaderChecked(e.target.checked)}
            className="size-4 rounded border-border"
          />
          サークル長にする
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink-on-brand hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? '保存中…' : '遠征届の役割を保存'}
        </button>
      </form>
    </section>
  )
}
