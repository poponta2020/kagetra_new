'use client'

import { useActionState } from 'react'
import { login, type LoginActionState } from './actions'

const initialState: LoginActionState = {}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-lg bg-white p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold">かげとら</h1>
          <p className="mt-2 text-sm text-gray-600">競技かるた会グループウェア</p>
        </div>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-700"
            >
              ユーザー名
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              パスワード
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
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
            {pending ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
