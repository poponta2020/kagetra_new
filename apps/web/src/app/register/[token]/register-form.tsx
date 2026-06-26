'use client'

import { useActionState, useState } from 'react'
import { registerViaInvite, type RegisterViaInviteState } from './actions'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const initialState: RegisterViaInviteState = {}

/**
 * Name (required) + grade (optional) form for invite-link registration.
 *
 * `token` is fixed via `.bind`, so this stays a useActionState
 * `(prevState, formData)` action. Inputs are controlled so a validation /
 * duplicate error keeps what the user typed (React 19 resets uncontrolled
 * fields after a form action). On success the action redirects to the
 * dashboard, so there is no success state to render here.
 */
export function RegisterForm({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const boundAction = registerViaInvite.bind(null, token)
  const [state, formAction, pending] = useActionState(boundAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="register-name" className="block text-sm font-medium text-gray-700">
          お名前（必須）
        </label>
        <input
          id="register-name"
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
        <label htmlFor="register-grade" className="block text-sm font-medium text-gray-700">
          級（任意）
        </label>
        <select
          id="register-grade"
          name="grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">未選択</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}級
            </option>
          ))}
        </select>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? '登録中…' : '登録する'}
      </button>
    </form>
  )
}
