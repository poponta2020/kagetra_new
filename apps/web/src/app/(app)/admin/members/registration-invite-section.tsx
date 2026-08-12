'use client'

import { useState, useTransition } from 'react'
import {
  createRegistrationInvite,
  revokeRegistrationInvite,
  type ActiveRegistrationInvite,
} from './actions'
import {
  REGISTRATION_INVITE_KINDS,
  type RegistrationInviteKind,
} from './registration-invite-kinds'
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

const KIND_LABELS: Record<RegistrationInviteKind, string> = {
  member: '会員用',
  guest: 'ゲスト用',
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
  const [kind, setKind] = useState<RegistrationInviteKind>('member')
  const [payload, setPayload] = useState<RegistrationInvitePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issuing, startIssue] = useTransition()
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [, startRevoke] = useTransition()

  function handleIssue() {
    setError(null)
    startIssue(async () => {
      const result = await createRegistrationInvite(preset, kind)
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
    <section className="space-y-3 rounded-lg bg-surface p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-ink">招待リンク</h3>
        <p className="mt-1 text-xs text-ink-meta">
          URLを渡すだけで本人が会員登録できます。期限内なら複数の人が利用できます。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-ink-2">
          種別
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RegistrationInviteKind)}
            className="ml-2 rounded-md border border-border px-2 py-1 text-sm"
            aria-label="招待リンクの種別"
          >
            {REGISTRATION_INVITE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-2">
          有効期限
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as RegistrationInviteExpiryPreset)}
            className="ml-2 rounded-md border border-border px-2 py-1 text-sm"
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
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {issuing ? '発行中…' : '招待リンクを発行'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {activeInvites.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-ink-2">現在有効な招待リンク</h4>
          <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
            {activeInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="text-ink-2">
                  <span className="mr-1 rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
                    {KIND_LABELS[inv.kind]}
                  </span>
                  発行 {formatDateTime(inv.createdAt)} ／ 失効 {formatDateTime(inv.expiresAt)}
                </span>
                <button
                  type="button"
                  onClick={() => handleRevoke(inv.id)}
                  disabled={revokingId === inv.id}
                  className="rounded-md bg-surface-alt px-3 py-1 text-xs text-ink-2 hover:bg-border-soft disabled:opacity-60"
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
