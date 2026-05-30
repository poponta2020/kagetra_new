'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Btn, Card, Pill, SectionLabel } from '@/components/ui'
import {
  BroadcastHistoryTable,
  type BroadcastHistoryRow,
} from './BroadcastHistoryTable'
import {
  InviteCodeModal,
  type InviteCodePayload,
} from './InviteCodeModal'

export type LineBroadcastBindingStatus =
  | 'unbound'
  | 'invite_pending'
  | 'joined_waiting_code'
  | 'linked'

export interface LineBroadcastSectionProps {
  eventId: number
  eventTitle: string
  /**
   * When false, the section renders a single read-only line so general
   * members can see that LINE delivery is in place without exposing the
   * channel ID / group ID.
   */
  isAdmin: boolean
  binding:
    | {
        status: LineBroadcastBindingStatus
        botLabel: string | null
        lineGroupIdTail: string | null
        linkedAt: Date | string | null
        lastBroadcastAt: Date | string | null
      }
    | null
  history: readonly BroadcastHistoryRow[]
  generateInviteCodeAction: (eventId: number) => Promise<InviteCodePayload>
  revokeBroadcastAction: (eventId: number) => Promise<void>
  /**
   * r-final-11 should_fix: failed / partial 行から再配信を呼べるように、
   * manualBroadcast を BroadcastHistoryTable まで流す。
   */
  manualBroadcastAction?: (
    eventId: number,
    mailMessageId: number,
  ) => Promise<void>
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

const STATUS_LABEL: Record<
  LineBroadcastBindingStatus,
  { label: string; tone: 'neutral' | 'info' | 'brand' }
> = {
  unbound: { label: '未連携', tone: 'neutral' },
  invite_pending: { label: '招待コード発行中', tone: 'info' },
  joined_waiting_code: { label: 'Bot 入室済み（コード待ち）', tone: 'info' },
  linked: { label: '配信中', tone: 'brand' },
}

export function LineBroadcastSection({
  eventId,
  eventTitle,
  isAdmin,
  binding,
  history,
  generateInviteCodeAction,
  revokeBroadcastAction,
  manualBroadcastAction,
}: LineBroadcastSectionProps) {
  const [pendingGenerate, startGenerate] = useTransition()
  const [pendingRevoke, startRevoke] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [modalPayload, setModalPayload] = useState<InviteCodePayload | null>(null)

  const status: LineBroadcastBindingStatus = binding?.status ?? 'unbound'
  const statusLabel = STATUS_LABEL[status]

  if (!isAdmin) {
    if (status === 'linked') {
      return (
        <section className="flex flex-col gap-2">
          <SectionLabel>LINE 配信</SectionLabel>
          <Card className="px-3 py-3 text-xs text-ink-2">
            この大会は LINE グループに自動配信されています。
          </Card>
        </section>
      )
    }
    return null
  }

  function handleGenerate() {
    setError(null)
    startGenerate(async () => {
      try {
        const payload = await generateInviteCodeAction(eventId)
        setModalPayload(payload)
      } catch (e) {
        setError(e instanceof Error ? e.message : '招待コードの発行に失敗しました')
      }
    })
  }

  function handleRevoke() {
    setError(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm('LINE 配信の連携を解除します。よろしいですか？')
      if (!ok) return
    }
    startRevoke(async () => {
      try {
        await revokeBroadcastAction(eventId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '解除に失敗しました')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionLabel>LINE 配信</SectionLabel>
        <Pill tone={statusLabel.tone} size="sm">
          {statusLabel.label}
        </Pill>
      </div>

      <Card className="px-3 py-3 flex flex-col gap-3 text-xs text-ink-2">
        {status === 'unbound' ? (
          <>
            <p>
              この大会の参加者 LINE グループへ、承認したメールを自動配信します。
            </p>
            <p className="text-[11px] text-ink-meta">
              まずは招待コードを発行し、Bot をグループに招待してください。
            </p>
            <div>
              <Btn
                type="button"
                kind="primary"
                size="sm"
                onClick={handleGenerate}
                disabled={pendingGenerate}
              >
                {pendingGenerate ? '発行中…' : 'LINE 配信を有効化'}
              </Btn>
            </div>
          </>
        ) : status === 'linked' ? (
          <>
            <dl className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-meta">連携 Bot</dt>
                <dd className="text-ink-1 truncate">{binding?.botLabel ?? '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-meta">LINE グループ</dt>
                <dd className="text-ink-1 font-mono text-[11px]">
                  {binding?.lineGroupIdTail
                    ? `…${binding.lineGroupIdTail}`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-meta">紐付け日時</dt>
                <dd className="text-ink-1">{formatDateTime(binding?.linkedAt)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-meta">最終配信</dt>
                <dd className="text-ink-1">
                  {formatDateTime(binding?.lastBroadcastAt)}
                </dd>
              </div>
            </dl>
            <div className="flex justify-end">
              <Btn
                type="button"
                kind="danger"
                size="sm"
                onClick={handleRevoke}
                disabled={pendingRevoke}
              >
                {pendingRevoke ? '解除中…' : '連携解除'}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <p>
              招待コードを発行済みです。Bot をグループに招待し、コードを発言すると
              紐付けが完了します。
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn
                type="button"
                kind="primary"
                size="sm"
                onClick={handleGenerate}
                disabled={pendingGenerate}
              >
                {pendingGenerate ? '再発行中…' : '招待コードを再発行'}
              </Btn>
              <Btn
                type="button"
                kind="ghost"
                size="sm"
                onClick={handleRevoke}
                disabled={pendingRevoke}
              >
                {pendingRevoke ? '解除中…' : '取り消し'}
              </Btn>
            </div>
            <p className="text-[10px] text-ink-meta">
              うまくいかない場合は
              {' '}
              <Link href="/admin/line-channels" className="text-brand hover:underline">
                /admin/line-channels
              </Link>
              {' '}
              から手動紐付けが可能です。
            </p>
          </>
        )}

        {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
      </Card>

      {status === 'linked' ? (
        <Card className="overflow-hidden">
          <BroadcastHistoryTable
            rows={history}
            eventId={eventId}
            manualBroadcastAction={manualBroadcastAction}
          />
        </Card>
      ) : null}

      <InviteCodeModal
        eventTitle={eventTitle}
        payload={modalPayload}
        onClose={() => setModalPayload(null)}
      />
    </section>
  )
}
