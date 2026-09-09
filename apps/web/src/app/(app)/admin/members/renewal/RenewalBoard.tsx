'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { formatEventDate, formatFlowDate } from '@/lib/event-date'
import { cn } from '@/lib/utils'
import type { RenewalBoard as RenewalBoardData, RenewalBoardRow, RenewalCategory } from '@/lib/membership-renewal/store'
import { Btn } from '@/components/ui'
import { changeDeadlineAction, type ChangeDeadlineState } from './actions'
import { MemberRow } from './MemberRow'
import { ProxyAnswerDialog } from './ProxyAnswerDialog'
import { CompleteDialog } from './CompleteDialog'
import { formatJstMonthDay, formatJstYmd } from './format'

/**
 * S2 進行中・完了後ボード（design-mock `renewal-admin.html` 2〜4 枚目）。
 *
 * 集計行 → 4 タブ → 正会員／准会員（／未判定）の区分見出し → 会員行、の
 * 要素順は design-spec §8 の忠実度チェック対象。完了後（`mode="completed"`）は
 * 代理回答・締切変更・登録完了を出さず、同じボードを読み取り専用で残す（R9）。
 */

const TABS: { key: RenewalCategory; label: string }[] = [
  { key: 'unanswered', label: '未回答' },
  { key: 'unchanged', label: '変更なし' },
  { key: 'changed', label: '変更あり' },
  { key: 'not_register', label: '登録しない' },
]

const MEMBERSHIP_GROUPS: { key: RenewalBoardRow['membershipKind']; label: string }[] = [
  { key: 'regular', label: '正会員' },
  { key: 'associate', label: '准会員' },
  { key: 'unknown', label: '未判定' },
]

function CapItem({ n, u, big = false }: { n: number; u: string; big?: boolean }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn('font-display font-bold leading-none tabular-nums text-ink', big ? 'text-lg' : 'text-base')}>
        {n}
      </span>
      <span className="text-xs text-ink-meta">{u}</span>
    </span>
  )
}

function TabButton({
  tab,
  label,
  count,
  active,
  onClick,
}: {
  tab: RenewalCategory
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  const isUnanswered = tab === 'unanswered'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 whitespace-nowrap border-b-2 pb-2 pt-1.5 text-center text-xs',
        active ? 'border-brand text-brand' : 'border-border text-ink-meta',
      )}
    >
      <span
        className={cn(
          'block font-display text-base font-bold leading-tight tabular-nums',
          isUnanswered ? 'text-accent-fg' : active ? 'text-brand' : 'text-ink-2',
        )}
      >
        {count}
      </span>
      {label}
    </button>
  )
}

function GroupHeading({ label, tabLabel, count }: { label: string; tabLabel: string; count: number }) {
  return (
    <div className="mt-4 flex items-baseline gap-2 border-b border-border-strong pb-[5px] text-xs font-semibold tracking-[0.04em] text-ink-meta">
      <span>{label}</span>
      <span className="ml-auto font-normal tabular-nums">
        {tabLabel} {count}
      </span>
    </div>
  )
}

const deadlineInitialState: ChangeDeadlineState = {}

function DeadlineChangeForm({
  renewalId,
  currentDeadline,
  onDone,
}: {
  renewalId: number
  currentDeadline: string
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState(changeDeadlineAction, deadlineInitialState)
  const [value, setValue] = useState(currentDeadline)

  if (state.success) {
    onDone()
  }

  return (
    <form action={formAction} className="mt-1 flex items-center gap-2 pb-2 text-xs">
      <input type="hidden" name="renewalId" value={renewalId} />
      <input
        type="date"
        name="deadline"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink"
      />
      <Btn type="submit" size="sm" disabled={pending}>
        {pending ? '保存中…' : '保存'}
      </Btn>
      <button type="button" onClick={onDone} className="text-ink-meta">
        やめる
      </button>
      {state.error && <span className="text-accent-fg">{state.error}</span>}
    </form>
  )
}

export interface RenewalBoardProps {
  board: RenewalBoardData
  mode: 'open' | 'completed'
  /** 登録完了ダイアログの人数・氏名（mode="open" のときだけ使う）。 */
  completionPreview?: { turnOffCount: number; unansweredNames: string[] }
}

export function RenewalBoard({ board, mode, completionPreview }: RenewalBoardProps) {
  const { renewal } = board
  const [activeTab, setActiveTab] = useState<RenewalCategory>('unanswered')
  const [proxyTarget, setProxyTarget] = useState<RenewalBoardRow | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [editingDeadline, setEditingDeadline] = useState(false)

  const tabRows = board.rows.filter((r) => r.isZennichikyoTarget && r.category === activeTab)
  const grouped = MEMBERSHIP_GROUPS.map((g) => ({
    ...g,
    rows: tabRows.filter((r) => r.membershipKind === g.key),
  })).filter((g) => g.rows.length > 0)

  const activeTabLabel = TABS.find((t) => t.key === activeTab)?.label ?? ''

  return (
    <div className="flex min-h-full flex-col p-4">
      <div className="sticky top-0 z-[3] -mx-4 -mt-4 border-b border-border-soft bg-canvas px-4 pt-[14px]">
        <nav className="flex items-baseline gap-[5px] pb-1 text-xs text-ink-meta">
          <Link href="/settings" className="text-brand hover:underline">
            設定
          </Link>
          <span aria-hidden>›</span>
          <Link href="/admin/members" className="text-brand hover:underline">
            会員
          </Link>
          <span aria-hidden>›</span>
          <span>年度確認</span>
        </nav>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl font-bold leading-tight text-ink">
            {renewal.fiscalYear}年度 登録確認
          </h1>
          {mode === 'completed' && renewal.completedAt && (
            <span className="text-xs text-ink-meta">完了 {formatJstYmd(renewal.completedAt)}</span>
          )}
        </div>
        <div className="mt-[3px] pb-[10px] text-xs tabular-nums text-ink-meta">
          {mode === 'open' ? (
            <>
              締切 {formatEventDate(renewal.deadline)} ／ 開始 {formatJstMonthDay(renewal.startedAt)}
              {board.nextReminderDate && (
                <> ／ 次のリマインド {formatFlowDate(board.nextReminderDate)} 20:00</>
              )}
              {!editingDeadline && (
                <button type="button" onClick={() => setEditingDeadline(true)} className="ml-1.5 text-brand">
                  締切を変更
                </button>
              )}
            </>
          ) : (
            <>提出・確定済みの年度確認です（閲覧のみ）</>
          )}
        </div>
        {mode === 'open' && editingDeadline && (
          <DeadlineChangeForm
            renewalId={renewal.id}
            currentDeadline={renewal.deadline}
            onDone={() => setEditingDeadline(false)}
          />
        )}
      </div>

      <div className="flex items-baseline gap-[26px] pt-[14px]">
        <CapItem n={board.zennichikyo.answered} u={`/ ${board.zennichikyo.total} 確認済み`} big />
        {mode === 'open' ? (
          <CapItem n={board.circle.answered} u={`/ ${board.circle.total} 学年`} />
        ) : (
          <>
            <CapItem n={board.counts.unchanged + board.counts.changed} u="継続" />
            <CapItem n={board.counts.not_register} u="登録しない" />
          </>
        )}
      </div>

      <div className="mt-3 flex gap-1">
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            tab={t.key}
            label={t.label}
            count={board.counts[t.key]}
            active={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
          />
        ))}
      </div>

      {grouped.length === 0 ? (
        <p className="mt-4 text-xs text-ink-muted">該当なし</p>
      ) : (
        grouped.map((g) => (
          <div key={g.key}>
            <GroupHeading label={g.label} tabLabel={activeTabLabel} count={g.rows.length} />
            {g.rows.map((row) => (
              <MemberRow
                key={row.userId}
                row={row}
                mode={mode}
                onProxyAnswer={mode === 'open' ? (r) => setProxyTarget(r) : undefined}
              />
            ))}
          </div>
        ))
      )}

      {mode === 'open' ? (
        <div className="sticky bottom-0 mt-auto -mx-4 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-meta">提出・確定後に押す</span>
            <Btn kind="secondary" size="lg" onClick={() => setCompleteOpen(true)}>
              登録完了にする
            </Btn>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-meta">
          完了後は閲覧のみ。次の年度確認は {renewal.fiscalYear + 1}年3月に開始できます。
        </p>
      )}

      {proxyTarget && (
        <ProxyAnswerDialog
          renewalId={renewal.id}
          userId={proxyTarget.userId}
          displayName={proxyTarget.displayName}
          onClose={() => setProxyTarget(null)}
        />
      )}

      {completeOpen && completionPreview && (
        <CompleteDialog
          renewalId={renewal.id}
          turnOffCount={completionPreview.turnOffCount}
          unansweredNames={completionPreview.unansweredNames}
          onClose={() => setCompleteOpen(false)}
        />
      )}
    </div>
  )
}
