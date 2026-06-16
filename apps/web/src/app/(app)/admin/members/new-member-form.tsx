'use client'

import { useActionState, useEffect, useState } from 'react'
import type { Grade } from '@kagetra/shared/types'
import { createMember, type CreateMemberState } from './actions'

const initialState: CreateMemberState = {}

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E'] as const

/**
 * Collapsible inline form to create a new member from the member list page.
 *
 * Inputs are controlled so a validation/duplicate error keeps what the admin
 * typed (React 19 would reset uncontrolled fields after every form action);
 * on success we clear them ourselves and show the status message.
 */
export function NewMemberForm() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [state, formAction, pending] = useActionState(
    createMember,
    initialState,
  )

  useEffect(() => {
    if (state.success) {
      setName('')
      setGrade('')
    }
  }, [state])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
      >
        新規会員追加
      </button>
    )
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
    >
      <h3 className="text-sm font-semibold text-gray-900">新規会員追加</h3>

      <div>
        <label
          htmlFor="new-member-name"
          className="block text-sm font-medium text-gray-700"
        >
          名前（必須）
        </label>
        <input
          id="new-member-name"
          name="name"
          type="text"
          required
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="new-member-grade"
          className="block text-sm font-medium text-gray-700"
        >
          級
        </label>
        <select
          id="new-member-grade"
          name="grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">未設定</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}級
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-500">
        登録した会員は LINE
        ログイン後の「自分の名前を選択」候補にすぐ表示されます。性別・所属などは登録後に編集画面で入力できます。
      </p>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-green-600">
          登録しました。
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? '登録中…' : '登録'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          閉じる
        </button>
      </div>
    </form>
  )
}
