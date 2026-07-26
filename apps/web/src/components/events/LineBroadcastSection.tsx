'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Btn } from '@/components/ui'
import { formatDateTimeFull, formatDateTimeShort } from '@/lib/event-date'
import {
  DisclosureActions,
  DisclosureRow,
  DisclosureSection,
  FlatTable,
  LinkAction,
  type FlatTableRow,
} from './detail'
import {
  BroadcastHistoryTable,
  type BroadcastHistoryRow,
} from './BroadcastHistoryTable'
import {
  GradeBroadcastSection,
  type GradeBroadcastRow,
} from './GradeBroadcastSection'
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
   * event-detail-redesign タスク5: 非管理者には何も描画しない
   * （AC-13b / AC-28。一般会員向けの案内文は廃止）。
   */
  isAdmin: boolean
  binding:
    | {
        status: LineBroadcastBindingStatus
        botLabel: string | null
        lineGroupIdTail: string | null
        linkedAt: Date | string | null
        lastBroadcastAt: Date | string | null
        // broadcast-guidelines-on-link: 選択済み要綱の件数と最終送信日時。
        guidelineCount: number
        guidelinesSentAt: Date | string | null
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
  setGuidelineAttachmentsAction: (
    eventId: number,
    attachmentIds: number[],
  ) => Promise<void>
  resendGuidelinesAction: (eventId: number) => Promise<void>
  /**
   * event-grade-group-broadcast: 級別グループ配信。**admin 限定**（vice_admin
   * には渡さない）ため、page.tsx が strict admin のときだけ値を渡す。
   * null/undefined のときは級別配信の行を描画しない（props ごと届かない＝
   * AC-29）。
   */
  gradeBroadcast?: {
    rows: readonly GradeBroadcastRow[]
    resendAction: (eventId: number) => Promise<void>
  } | null
}

const STATUS_LABEL: Record<LineBroadcastBindingStatus, string> = {
  unbound: '未連携',
  invite_pending: '招待コード発行中',
  joined_waiting_code: 'Bot 入室済み（コード待ち）',
  linked: '配信中',
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
  setGuidelineAttachmentsAction,
  resendGuidelinesAction,
  gradeBroadcast,
}: LineBroadcastSectionProps) {
  const [pendingGenerate, startGenerate] = useTransition()
  const [pendingRevoke, startRevoke] = useTransition()
  const [pendingResend, startResend] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [modalPayload, setModalPayload] = useState<InviteCodePayload | null>(null)

  // AC-13b/AC-28: 非管理者には何も描画しない（一般会員向けの案内文は廃止）。
  if (!isAdmin) return null

  const status: LineBroadcastBindingStatus = binding?.status ?? 'unbound'
  const statusLabel = STATUS_LABEL[status]

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

  function handleResend() {
    setError(null)
    startResend(async () => {
      try {
        await resendGuidelinesAction(eventId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '要綱の再送に失敗しました')
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

  // 完全失敗（failed）と部分失敗（partial）は深刻度が違うので集計を分ける。
  // 一緒に数えて「部分失敗」と表示すると、トグルを閉じている管理者に完全失敗が
  // 部分失敗として見え、障害の深刻度を誤認させる。
  const failedCount = history.filter((r) => r.status === 'failed').length
  const partialCount = history.filter((r) => r.status === 'partial').length
  const historyAux =
    failedCount > 0 && partialCount > 0
      ? `失敗 ${failedCount}件・部分失敗 ${partialCount}件`
      : failedCount > 0
        ? `${failedCount}件 失敗`
        : partialCount > 0
          ? `${partialCount}件 部分失敗`
          : undefined

  const bindingRows: FlatTableRow[] = binding
    ? [
        {
          label: 'グループ',
          value: binding.lineGroupIdTail ? `…${binding.lineGroupIdTail}` : '—',
          valueClassName: 'font-mono text-xs',
        },
        {
          label: '紐付け',
          value: formatDateTimeFull(binding.linkedAt),
          variant: 'date',
        },
        {
          label: '最終配信',
          value: formatDateTimeFull(binding.lastBroadcastAt),
          variant: 'date',
        },
        {
          label: '要綱',
          value: (
            <>
              {binding.guidelineCount}件選択済み
              {binding.guidelinesSentAt ? (
                <div className="mt-[3px] text-xs text-neutral-fg">
                  最終送信 {formatDateTimeShort(binding.guidelinesSentAt)}
                </div>
              ) : null}
            </>
          ),
        },
      ]
    : []

  return (
    <DisclosureSection
      title="LINE 配信"
      aux={statusLabel}
      auxTone={status === 'unbound' ? 'warn' : 'meta'}
      nested
      // セクション間余白（モックの `.sec{padding:34px 0 0}`）は自前で持つ。
      // 非管理者では上で null を返すので、呼び出し側がラッパーで付けると
      // 空の 34px が残ってしまう。
      className="pt-[34px]"
    >
      {status === 'unbound' ? (
        <>
          <p className="text-xs leading-[1.75] text-neutral-fg">
            この大会の参加者 LINE グループへ、承認したメールを自動配信します。まず招待コードを発行し、Bot をグループに招待してください。
          </p>
          <DisclosureActions>
            <Btn
              type="button"
              size="sm"
              className="h-[30px] rounded-md"
              onClick={handleGenerate}
              disabled={pendingGenerate}
            >
              {pendingGenerate ? '発行中…' : 'LINE 配信を有効化'}
            </Btn>
          </DisclosureActions>
        </>
      ) : status === 'linked' ? (
        <>
          <DisclosureRow label="連携状況" value={binding?.botLabel ?? '—'}>
            <FlatTable rows={bindingRows} />
            <DisclosureActions>
              {(binding?.guidelineCount ?? 0) > 0 ? (
                <LinkAction onClick={handleResend} disabled={pendingResend}>
                  {pendingResend ? '送信中…' : '要綱を再送'}
                </LinkAction>
              ) : null}
              <LinkAction
                tone="danger"
                onClick={handleRevoke}
                disabled={pendingRevoke}
              >
                {pendingRevoke ? '解除中…' : '連携解除'}
              </LinkAction>
            </DisclosureActions>
          </DisclosureRow>

          <DisclosureRow
            label="配信履歴"
            value={`${history.length}件`}
            aux={historyAux}
            auxTone="warn"
          >
            <BroadcastHistoryTable
              rows={history}
              eventId={eventId}
              manualBroadcastAction={manualBroadcastAction}
            />
          </DisclosureRow>

          {gradeBroadcast && gradeBroadcast.rows.length > 0 ? (
            <GradeBroadcastSection
              eventId={eventId}
              rows={gradeBroadcast.rows}
              resendAction={gradeBroadcast.resendAction}
            />
          ) : null}
        </>
      ) : (
        <>
          <p className="text-xs leading-[1.75] text-neutral-fg">
            Bot をグループに招待し、コードを発言すると紐付けが完了します。うまくいかない場合は
            {' '}
            <Link href="/admin/line-channels" className="text-brand hover:underline">
              /admin/line-channels
            </Link>
            {' '}
            から手動で紐付けできます。
          </p>
          <DisclosureActions>
            <LinkAction
              tone="danger"
              onClick={handleRevoke}
              disabled={pendingRevoke}
            >
              {pendingRevoke ? '解除中…' : '取り消し'}
            </LinkAction>
            <Btn
              type="button"
              size="sm"
              className="h-[30px] rounded-md"
              onClick={handleGenerate}
              disabled={pendingGenerate}
            >
              {pendingGenerate ? '再発行中…' : '招待コードを再発行'}
            </Btn>
          </DisclosureActions>
        </>
      )}

      {error ? <p className="pt-2 text-xs text-danger-fg">{error}</p> : null}

      <InviteCodeModal
        eventId={eventId}
        eventTitle={eventTitle}
        payload={modalPayload}
        onClose={() => setModalPayload(null)}
        setGuidelineAttachmentsAction={setGuidelineAttachmentsAction}
      />
    </DisclosureSection>
  )
}
