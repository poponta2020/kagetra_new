'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Btn, GradePill, Pill, type PillTone } from '@/components/ui'
import type { GeneratedGradeInviteCode } from './actions'
import type { Grade } from './grades'

export type GradeGroupStatus =
  | 'unbound'
  | 'invite_pending'
  | 'joined_waiting_code'
  | 'linked'

export interface GradeGroupRow {
  grade: Grade
  status: GradeGroupStatus
  botLabel: string | null
  lineGroupIdTail: string | null
  linkedAt: Date | string | null
}

export interface GradeGroupListProps {
  rows: readonly GradeGroupRow[]
  generateInviteCodeAction: (grade: Grade) => Promise<GeneratedGradeInviteCode>
  revokeBindingAction: (grade: Grade) => Promise<void>
}

const STATUS_LABEL: Record<GradeGroupStatus, { label: string; tone: PillTone }> = {
  unbound: { label: '未紐付け', tone: 'neutral' },
  invite_pending: { label: '招待コード発行済み', tone: 'info' },
  joined_waiting_code: { label: '参加済みコード待ち', tone: 'info' },
  linked: { label: '紐付け済み', tone: 'brand' },
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

function useCountdown(expiresAt: Date | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return ''
  const diffMs = Math.max(0, expiresAt.getTime() - now)
  const totalSec = Math.floor(diffMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface ModalState {
  grade: Grade
  payload: GeneratedGradeInviteCode
}

/**
 * Invite-code display modal. Deliberately simpler than
 * `../../events/[id]/InviteCodeModal.tsx` — grade groups have no guideline
 * attachment selection.
 */
function GradeInviteModal({
  state,
  onClose,
}: {
  state: ModalState | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()
  const countdown = useCountdown(state?.payload.expiresAt ?? null)

  useEffect(() => {
    if (state) setCopied(false)
  }, [state])

  if (!state) return null
  const { grade, payload } = state

  function handleCopy() {
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(payload.inviteCode)
        setCopied(true)
      } catch {
        // Clipboard access can be blocked — no-op, code is still selectable.
      }
    })
  }

  // Portal + .modal-overlay-h (svh cascade) — same pattern as
  // ../../events/[id]/InviteCodeModal.tsx.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${grade}級 LINE グループ 招待コード`}
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-full overflow-y-auto w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-1">招待コード</h2>
            <p className="text-[11px] text-ink-meta truncate">{grade}級</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-meta hover:text-ink-1 text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col items-center gap-2 py-4 bg-surface-alt rounded-xl">
          <div className="text-[11px] text-ink-meta">6 桁数字を LINE グループで発言</div>
          <div className="text-4xl font-mono font-semibold tracking-[0.4em] text-ink-1">
            {payload.inviteCode}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-meta tabular-nums">
            <span>残り {countdown}</span>
            <span>·</span>
            <span>{formatDateTime(payload.expiresAt)} まで</span>
          </div>
          <Btn type="button" kind="ghost" size="sm" onClick={handleCopy}>
            {copied ? 'コピーしました' : 'コードをコピー'}
          </Btn>
        </div>

        <ol className="text-xs text-ink-2 flex flex-col gap-1.5 list-decimal list-inside">
          <li>
            <a
              href={payload.addFriendUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              {payload.botLabel}
            </a>
            {' '}
            を友だち追加
          </li>
          <li>LINE で {grade}級 参加者グループを作成</li>
          <li>作成したグループに {payload.botLabel} を招待</li>
          <li>グループ内で上記 6 桁コードを発言</li>
        </ol>

        <p className="text-[10px] text-ink-meta">
          紐付けが完了すると、この級の状態が「紐付け済み」に切り替わります。
        </p>

        <div className="flex justify-end pt-1">
          <Btn type="button" kind="secondary" size="sm" onClick={onClose}>
            閉じる
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function GradeGroupList({
  rows,
  generateInviteCodeAction,
  revokeBindingAction,
}: GradeGroupListProps) {
  const [pendingGrade, setPendingGrade] = useState<Grade | null>(null)
  const [pendingAction, setPendingAction] = useState<'generate' | 'revoke' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [, startTransition] = useTransition()

  function handleGenerate(grade: Grade) {
    setError(null)
    setPendingGrade(grade)
    setPendingAction('generate')
    startTransition(async () => {
      try {
        const payload = await generateInviteCodeAction(grade)
        setModalState({ grade, payload })
      } catch (e) {
        setError(e instanceof Error ? e.message : '招待コードの発行に失敗しました')
      } finally {
        setPendingGrade(null)
        setPendingAction(null)
      }
    })
  }

  function handleRevoke(grade: Grade) {
    setError(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`${grade}級 の LINE グループ紐付けを解除します。よろしいですか？`)
      if (!ok) return
    }
    setPendingGrade(grade)
    setPendingAction('revoke')
    startTransition(async () => {
      try {
        await revokeBindingAction(grade)
      } catch (e) {
        setError(e instanceof Error ? e.message : '解除に失敗しました')
      } finally {
        setPendingGrade(null)
        setPendingAction(null)
      }
    })
  }

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border/60">
        {rows.map((row) => {
          const statusLabel = STATUS_LABEL[row.status]
          const isBusy = pendingGrade === row.grade
          return (
            <li key={row.grade} className="px-3 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GradePill grade={row.grade} size="md" />
                  <Pill tone={statusLabel.tone} size="sm">
                    {statusLabel.label}
                  </Pill>
                </div>
              </div>
              {row.status !== 'unbound' ? (
                <dl className="flex flex-col gap-0.5 text-[11px] text-ink-meta">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt>連携 Bot</dt>
                    <dd className="text-ink-2 truncate">{row.botLabel ?? '—'}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt>LINE グループ</dt>
                    <dd className="text-ink-2 font-mono">
                      {row.lineGroupIdTail ? `…${row.lineGroupIdTail}` : '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt>紐付け日時</dt>
                    <dd className="text-ink-2">{formatDateTime(row.linkedAt)}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="flex justify-end gap-2">
                {/* review r1 blocker: 紐付け済みの級は再発行で紐付けが壊れる
                    （Server Action 側でも拒否する）。付け替えたい場合は先に
                    確認付きの「解除」を通させる。 */}
                {row.status !== 'linked' ? (
                  <Btn
                    type="button"
                    kind="primary"
                    size="sm"
                    onClick={() => handleGenerate(row.grade)}
                    disabled={isBusy}
                  >
                    {isBusy && pendingAction === 'generate'
                      ? '発行中…'
                      : row.status === 'unbound'
                        ? '招待コード発行'
                        : '招待コードを再発行'}
                  </Btn>
                ) : null}
                {row.status !== 'unbound' ? (
                  <Btn
                    type="button"
                    kind="ghost"
                    size="sm"
                    onClick={() => handleRevoke(row.grade)}
                    disabled={isBusy}
                  >
                    {isBusy && pendingAction === 'revoke' ? '解除中…' : '解除'}
                  </Btn>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {error ? <p className="px-3 pb-3 text-xs text-danger-fg">{error}</p> : null}

      <GradeInviteModal state={modalState} onClose={() => setModalState(null)} />
    </div>
  )
}
