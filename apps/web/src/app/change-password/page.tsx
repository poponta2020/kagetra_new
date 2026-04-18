'use client'

import { useActionState } from 'react'
import {
  changePasswordAction,
  type ChangePasswordActionState,
} from './actions'
import { MIN_PASSWORD_LENGTH } from './constants'

const initialState: ChangePasswordActionState = {}

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initialState,
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-lg bg-white p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-xl font-bold">パスワード変更</h1>
          <p className="mt-2 text-sm text-gray-600">
            初回ログインのため、パスワードを変更してください。
          </p>
        </div>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium text-gray-700"
            >
              現在のパスワード
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-gray-700"
            >
              新しいパスワード（{MIN_PASSWORD_LENGTH}文字以上）
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-gray-700"
            >
              新しいパスワード（確認）
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? '更新中…' : 'パスワードを変更'}
          </button>
        </form>
      </div>
    </div>
  )
}
