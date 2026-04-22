'use client'

import { useMemo, useState } from 'react'
import { claimMemberIdentity } from './actions'

export type Candidate = {
  id: string
  name: string | null
}

export function CandidateList({ candidates }: { candidates: Candidate[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) =>
      (c.name ?? '').toLowerCase().includes(q),
    )
  }, [candidates, query])

  return (
    <form action={claimMemberIdentity} className="space-y-4">
      <div>
        <label htmlFor="self-identify-search" className="sr-only">
          会員を検索
        </label>
        <input
          id="self-identify-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="お名前で検索"
          autoComplete="off"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
          一致する会員が見つかりません。
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {filtered.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <input
                  type="radio"
                  name="userId"
                  value={c.id}
                  required
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-900">
                  {c.name ?? '(名前未設定)'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand/90"
      >
        このメンバーとして続ける
      </button>
    </form>
  )
}
