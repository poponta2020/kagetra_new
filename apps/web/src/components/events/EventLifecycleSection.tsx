'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Btn } from '@/components/ui'
import { formatDateTimeShort, formatEventDate } from '@/lib/event-date'
import type { GroupSiblingEvent } from '@/lib/entry-groups'
import {
  DisclosureActions,
  DisclosureRow,
  FlatTable,
  GroupToggleDialog,
  LinkAction,
  SectionRule,
  type FlatTableRow,
  type GroupToggleDialogOption,
} from './detail'
import type { EntryStatus, PaymentStatus, PaymentType } from './LifecycleStatusBadge'

type BulkDialogKind = 'entryApplied' | 'paymentPaid' | 'paymentType'

const BULK_DIALOG_HEADING: Record<BulkDialogKind, string> = {
  entryApplied: '申込済にする対象の日を選択',
  paymentPaid: '支払済にする対象の日を選択',
  paymentType: '支払いタイプ変更の対象の日を選択',
}

export interface EventLifecycleSectionProps {
  eventId: number
  entryStatus: EntryStatus
  paymentType: PaymentType | null
  paymentStatus: PaymentStatus
  feeJpy: number | null
  entryDeadline: string | null
  paymentDeadline: string | null
  // event-detail-redesign タスク5: 一般会員から隠して管理者トグル内へ集約
  // する情報（requirements §3.2.2）。
  entryMethod: string | null
  paymentMethod: string | null
  paymentInfo: string | null
  /**
   * Whether the event has a live (`linked`) LINE group. Drives the "通知が
   * 送られます" confirmation. State changes are always persisted; the
   * notification only fires when linked.
   */
  isLineLinked: boolean
  setEntryAppliedAction: (eventId: number, applied: boolean) => Promise<void>
  // entry-overdue-alert: 3 値目「申し込まない」。not_applied のときだけ
  // 呼べる（not_applying → applied の直接遷移は UI に無い）。
  setEntryNotApplyingAction: (eventId: number) => Promise<void>
  setPaymentTypeAction: (
    eventId: number,
    type: 'advance' | 'onsite' | null,
  ) => Promise<void>
  setPaymentPaidAction: (eventId: number, paid: boolean) => Promise<void>
  /**
   * entry-groups タスク4 (AC-8/9/10/11/16): 同グループの他の日
   * （開催日昇順・自分を含む）。2件以上のときだけ一括ダイアログを出す。
   * 未指定/1件以下は既存の単一トグル動作（このコンポーネントの
   * 既存テストが固定している window.confirm→scalar action 呼び出し）を
   * 一切変更しない。
   */
  groupSiblings?: readonly GroupSiblingEvent[]
  /** 申込済一括トグル（AC-8/9）。`groupSiblings.length > 1` のときのみ使う。 */
  setEntriesAppliedAction?: (eventIds: number[], applied: boolean) => Promise<void>
  /** 支払済一括トグル（AC-10）。`groupSiblings.length > 1` のときのみ使う。 */
  setPaymentsPaidAction?: (eventIds: number[], paid: boolean) => Promise<void>
  /** 支払いタイプ一括設定（AC-10）。`groupSiblings.length > 1` のときのみ使う。 */
  setPaymentTypesAction?: (
    eventIds: number[],
    type: 'advance' | 'onsite' | null,
  ) => Promise<void>
  /**
   * entry-form-autofill タスク8 (AC-3/AC-17): 申込書作成への導線。
   * 個人戦（`kind='individual'`）のときだけ渡す。未指定なら「申込書」行を出さない
   * （団体戦は Non-goal）。
   */
  entryFormGroupId?: number
  /** 最新の申込書下書き。未作成なら null。 */
  entryFormLatestDraft?: EntryFormDraftRow | null
}

/** 申込書下書きの最新作成履歴（`entry_form_drafts` の最新行）。 */
export interface EntryFormDraftRow {
  id: number
  createdAt: Date | string
  createdByName: string | null
  attachmentFilename: string
  status: 'pending' | 'created' | 'imap_failed'
}

// design-spec §9「既存プリミティブを変更せず、この画面用の派生として実装
// する」— モックの下線だけの `<select>`（枠なし）。
const SELECT_CLASS =
  'border-b border-border-strong bg-transparent px-px py-0.5 text-[13px] text-ink'

const ENTRY_SUMMARY: Record<
  EntryStatus,
  { label: string; tone: 'plain' | 'ok' | 'ng' }
> = {
  not_applied: { label: '未申込', tone: 'plain' },
  applied: { label: '申込済', tone: 'ok' },
  not_applying: { label: '申込なし', tone: 'plain' },
}

function paymentSummary(
  paymentType: PaymentType | null,
  paymentStatus: PaymentStatus,
): { label: string; tone: 'plain' | 'ok' | 'ng' } {
  if (paymentType === 'advance') {
    return paymentStatus === 'paid'
      ? { label: '支払済', tone: 'ok' }
      : { label: '未払', tone: 'ng' }
  }
  if (paymentType === 'onsite') return { label: '現地払い', tone: 'plain' }
  return { label: '未設定', tone: 'ng' }
}

/**
 * Admin-only 進行管理 section on /events/[id]: 申込状態／支払状態を独立した
 * 開閉トグル 2 つに畳む（design-spec §4）。参加費・支払締切・支払方法・
 * 振込先など一般会員に見せない情報は支払トグルの中に集約する
 * （requirements §3.2.2）。
 */
const ENTRY_FORM_SUMMARY: Record<
  'none' | 'pending' | 'created' | 'imap_failed',
  { label: string; tone: 'plain' | 'ok' | 'ng' }
> = {
  none: { label: '未作成', tone: 'plain' },
  // xlsx は生成・保存済みだが APPEND の結果が確定していない（作成中にプロセスが
  // 落ちた等）。Yahoo 側に下書きがあるか分からないので成功とは言い切らない。
  pending: { label: '作成結果を確認中', tone: 'plain' },
  created: { label: '下書き作成済', tone: 'ok' },
  // 生成 xlsx は残っているが Yahoo への書き込みは失敗している状態。
  imap_failed: { label: '下書き未作成（失敗）', tone: 'ng' },
}

export function EventLifecycleSection({
  eventId,
  entryStatus,
  paymentType,
  paymentStatus,
  feeJpy,
  entryDeadline,
  paymentDeadline,
  entryMethod,
  paymentMethod,
  paymentInfo,
  isLineLinked,
  setEntryAppliedAction,
  setEntryNotApplyingAction,
  setPaymentTypeAction,
  setPaymentPaidAction,
  groupSiblings = [],
  setEntriesAppliedAction,
  setPaymentsPaidAction,
  setPaymentTypesAction,
  entryFormGroupId,
  entryFormLatestDraft = null,
}: EventLifecycleSectionProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // entry-groups タスク4: 一括ダイアログの開閉状態。paymentType のときだけ
  // 選ばれた値を保持する（select の onChange 時点で値は確定しているため）。
  const [bulkDialog, setBulkDialog] = useState<{
    kind: BulkDialogKind
    paymentTypeValue?: 'advance' | 'onsite' | null
  } | null>(null)
  // 2件以上あるときだけ一括ダイアログを出す（1件=自分のみ、なら従来どおり）。
  const hasGroupDialog = groupSiblings.length > 1
  const bulkDialogOptions: GroupToggleDialogOption[] = groupSiblings.map((s) => ({
    id: s.id,
    title: s.title,
    eventDate: s.eventDate,
    disabled: s.status === 'cancelled',
  }))

  /**
   * Run a state-change action. When `willNotify` and the group is linked, ask
   * for confirmation first (a completion push will be sent). Reverts and
   * payment-type changes pass willNotify=false (no notification).
   */
  function run(action: () => Promise<void>, willNotify: boolean) {
    setError(null)
    if (willNotify && isLineLinked && typeof window !== 'undefined') {
      const ok = window.confirm(
        '参加者の LINE グループに通知が送られます。よろしいですか？',
      )
      if (!ok) return
    }
    startTransition(async () => {
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  /**
   * entry-overdue-alert: 「申し込まない」への設定。LINE 通知は飛ばないが、
   * 大会申込一覧から消える不可視化を伴うため、`run` の通知 confirm とは別に
   * 常に確認する（isLineLinked に関係なく出す）。
   */
  function runNotApplying() {
    setError(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'この大会は大会申込一覧に表示されなくなります。よろしいですか？',
      )
      if (!ok) return
    }
    startTransition(async () => {
      try {
        await setEntryNotApplyingAction(eventId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  /**
   * entry-groups タスク4: 一括ダイアログで選択が確定したときの実行部。
   * `entryApplied` / `paymentPaid` は通知を伴うので、既存の `run` と同じ
   * window.confirm を手前に挟む。`paymentType` は通知を送らないので確認なし。
   */
  function confirmBulkDialog(selectedIds: number[]) {
    if (!bulkDialog) return
    const willNotify = bulkDialog.kind !== 'paymentType'
    if (willNotify && isLineLinked && typeof window !== 'undefined') {
      const ok = window.confirm(
        '参加者の LINE グループに通知が送られます。よろしいですか？',
      )
      if (!ok) return
    }
    const kind = bulkDialog.kind
    const paymentTypeValue = bulkDialog.paymentTypeValue ?? null
    setBulkDialog(null)
    setError(null)
    startTransition(async () => {
      try {
        if (kind === 'entryApplied') {
          await setEntriesAppliedAction?.(selectedIds, true)
        } else if (kind === 'paymentPaid') {
          await setPaymentsPaidAction?.(selectedIds, true)
        } else {
          await setPaymentTypesAction?.(selectedIds, paymentTypeValue)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  const paymentPaid = paymentStatus === 'paid'
  const entrySummary = ENTRY_SUMMARY[entryStatus]
  const entryFormSummary = ENTRY_FORM_SUMMARY[entryFormLatestDraft?.status ?? 'none']
  const paySummary = paymentSummary(paymentType, paymentStatus)

  const entryRows: FlatTableRow[] = []
  if (entryMethod != null) {
    entryRows.push({ label: '申込方法', value: entryMethod })
  }
  entryRows.push({
    label: '大会申込締切',
    value: entryDeadline ? formatEventDate(entryDeadline) : '未定',
    variant: 'date',
  })

  const paymentRows: FlatTableRow[] = []
  if (feeJpy != null) {
    paymentRows.push({
      label: '参加費',
      value: `${feeJpy.toLocaleString('ja-JP')}円`,
    })
  }
  if (paymentDeadline != null) {
    paymentRows.push({
      label: '支払締切',
      value: formatEventDate(paymentDeadline),
      variant: 'date',
    })
  }
  if (paymentMethod != null) {
    paymentRows.push({ label: '支払方法', value: paymentMethod })
  }
  if (paymentInfo != null) {
    paymentRows.push({
      label: '振込先',
      value: paymentInfo,
      variant: 'prewrap',
    })
  }

  return (
    <SectionRule title="進行管理">
      <DisclosureRow
        label="申込状態"
        value={entrySummary.label}
        valueTone={entrySummary.tone}
      >
        <FlatTable rows={entryRows} />
        <DisclosureActions>
          {entryStatus === 'not_applied' ? (
            <>
              <LinkAction disabled={isPending} onClick={runNotApplying}>
                申し込まない
              </LinkAction>
              <Btn
                type="button"
                size="sm"
                className="h-[30px] rounded-md"
                disabled={isPending}
                onClick={() => {
                  if (hasGroupDialog) {
                    setBulkDialog({ kind: 'entryApplied' })
                    return
                  }
                  run(() => setEntryAppliedAction(eventId, true), true)
                }}
              >
                申込済にする
              </Btn>
            </>
          ) : (
            <LinkAction
              disabled={isPending}
              onClick={() =>
                run(() => setEntryAppliedAction(eventId, false), false)
              }
            >
              未申込に戻す
            </LinkAction>
          )}
        </DisclosureActions>
      </DisclosureRow>

      {/* entry-form-autofill タスク8 (AC-3/AC-17): 申込書作成への導線と最新の
          作成履歴。個人戦のときだけ `entryFormGroupId` が渡る（団体戦は Non-goal）。 */}
      {entryFormGroupId != null && (
        <DisclosureRow
          label="申込書"
          value={entryFormSummary.label}
          valueTone={entryFormSummary.tone}
        >
          {entryFormLatestDraft && (
            <FlatTable
              rows={[
                {
                  label: '最終作成',
                  value: `${formatDateTimeShort(entryFormLatestDraft.createdAt)}・${
                    entryFormLatestDraft.createdByName ?? '不明'
                  }`,
                },
                {
                  label: 'ファイル',
                  value: (
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 break-all">
                        {entryFormLatestDraft.attachmentFilename}
                      </span>
                      <a
                        href={`/api/admin/entry-form/drafts/${entryFormLatestDraft.id}`}
                        download
                        className="shrink-0 text-xs text-brand-fg underline"
                      >
                        DL
                      </a>
                    </span>
                  ),
                },
              ]}
            />
          )}
          <DisclosureActions>
            <Link
              href={`/admin/entry-form/${entryFormGroupId}`}
              className="text-[13px] text-brand-fg underline"
            >
              {entryFormLatestDraft ? '再作成' : '申込書を作成'}
            </Link>
          </DisclosureActions>
        </DisclosureRow>
      )}

      <DisclosureRow
        label="支払状態"
        value={paySummary.label}
        valueTone={paySummary.tone}
      >
        <FlatTable rows={paymentRows} />
        <DisclosureActions>
          <select
            className={SELECT_CLASS}
            value={paymentType ?? ''}
            disabled={isPending}
            onChange={(e) => {
              const next =
                e.target.value === '' ? null : (e.target.value as PaymentType)
              if (hasGroupDialog) {
                setBulkDialog({ kind: 'paymentType', paymentTypeValue: next })
                return
              }
              run(() => setPaymentTypeAction(eventId, next), false)
            }}
          >
            <option value="">未設定</option>
            <option value="advance">事前払い</option>
            <option value="onsite">現地払い</option>
          </select>
          {paymentType === 'advance' && (
            <Btn
              type="button"
              kind={paymentPaid ? 'secondary' : 'primary'}
              size="sm"
              className="h-[30px] rounded-md"
              disabled={isPending}
              onClick={() => {
                const next = !paymentPaid
                if (next && hasGroupDialog) {
                  setBulkDialog({ kind: 'paymentPaid' })
                  return
                }
                run(() => setPaymentPaidAction(eventId, next), next)
              }}
            >
              {paymentPaid ? '未払に戻す' : '支払済にする'}
            </Btn>
          )}
        </DisclosureActions>
      </DisclosureRow>

      {error ? <p className="pt-2 text-xs text-danger-fg">{error}</p> : null}

      {bulkDialog && (
        <GroupToggleDialog
          heading={BULK_DIALOG_HEADING[bulkDialog.kind]}
          options={bulkDialogOptions}
          pending={isPending}
          onCancel={() => setBulkDialog(null)}
          onConfirm={confirmBulkDialog}
        />
      )}
    </SectionRule>
  )
}
