'use client'

import { useState, useTransition } from 'react'
import {
  createRegistrationInvite,
  revokeRegistrationInvite,
  type ActiveRegistrationInvite,
} from './actions'
import {
  RegistrationInviteModal,
  type RegistrationInvitePayload,
} from '@/components/admin/RegistrationInviteModal'
import {
  DEFAULT_EXPIRY_PRESET,
  EXPIRY_PRESET_OPTIONS,
  type RegistrationInviteExpiryPreset,
} from '@/lib/registration-invite'

const PRESET_LABELS: Record<RegistrationInviteExpiryPreset, string> = {
  '1d': '1日',
  '7d': '7日',
  '30d': '30日',
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Admin "招待リンク" section: pick an expiry preset, issue a link (opens the
 * URL/copy modal), and revoke any currently-active link. `activeInvites` is
 * fetched server-side and refreshed automatically — both actions call
 * revalidatePath('/admin/members'), so issuing/revoking re-renders this list.
 */
export function RegistrationInviteSection({
  activeInvites,
}: {
  activeInvites: ActiveRegistrationInvite[]
}) {
  const [preset, setPreset] = useState<RegistrationInviteExpiryPreset>(DEFAULT_EXPIRY_PRESET)
  const [payload, setPayload] = useState<RegistrationInvitePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issuing, startIssue] = useTransition()
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [, startRevoke] = useTransition()

  function handleIssue() {
    setError(null)
    startIssue(async () => {
      const result = await createRegistrationInvite(preset)
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.url && result.expiresAt) {
        setPayload({ url: result.url, expiresAt: new Date(result.expiresAt) })
      }
    })
  }

  function handleRevoke(id: string) {
    setRevokingId(id)
    startRevoke(async () => {
      try {
        await revokeRegistrationInvite(id)
      } finally {
        setRevokingId(null)
      }
    })
  }

  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">招待リンク</h3>
        <p className="mt-1 text-xs text-gray-500">
          URLを渡すだけで本人が会員登録できます。期限内なら複数の人が利用できます。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-gray-700">
          有効期限
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as RegistrationInviteExpiryPreset)}
            className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm"
            aria-label="招待リンクの有効期限"
          >
            {EXPIRY_PRESET_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleIssue}
          disabled={issuing}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {issuing ? '発行中…' : '招待リンクを発行'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {activeInvites.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-700">現在有効な招待リンク</h4>
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {activeInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="text-gray-600">
                  発行 {formatDateTime(inv.createdAt)} ／ 失効 {formatDateTime(inv.expiresAt)}
                </span>
                <button
                  type="button"
                  onClick={() => handleRevoke(inv.id)}
                  disabled={revokingId === inv.id}
                  className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-60"
                >
                  {revokingId === inv.id ? '無効化中…' : '無効化'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RegistrationInviteModal payload={payload} onClose={() => setPayload(null)} />
    </section>
  )
}
