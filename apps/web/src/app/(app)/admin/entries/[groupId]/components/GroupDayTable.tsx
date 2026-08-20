'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Btn } from '@/components/ui'
import { formatEventDate } from '@/lib/event-date'
import { cn } from '@/lib/utils'
import type { DayPhaseTone } from '../../day-phase'

/**
 * 日程表（日×状態）＋一括操作バー。design-spec §2 の**案C（進行フェーズ1語）**。
 * 視覚の正は `design-mock/page-admin.html` の `.days.opt-c` と `.bulk`。
 *
 * 選択状態を持つので client component。**判定は一切ここでしない** —— フェーズ語
 * （`dayPhase`）も表示名も参加希望者数も、すべてサーバー（page.tsx）が計算済みの
 * 値として降りてくる。`classify` を client バンドルへ持ち込まないためと、
 * 「同じ語彙を2箇所で作らない」ため。
 *
 * 管理者と一般会員の差は**チェックボックスと一括操作バーの有無だけ**（要件 AC-9 /
 * design-spec §8）。列も情報量も同じにする。
 */

/** 日程表の1行。管理者・一般会員で同一（AC-9）。 */
export interface GroupDayRow {
  id: number
  /** `YYYY-MM-DD`。 */
  eventDate: string
  /** その日の大会名（通称ベース。`displayName`）。 */
  name: string
  /** 対象級（例 `ABC`）。未設定は `—`。**truncate しない**（design-spec §8）。 */
  gradesLabel: string
  /** 進行フェーズ1語（`dayPhase`）。 */
  phaseLabel: string
  phaseTone: DayPhaseTone
  /** 参加希望者数（`attend=true` の素通し・ゲスト除外）。0 でも出す。 */
  attendCount: number
  /** 自分の出欠回答。true=参加 / false=不参加 / null=未回答。 */
  myAttend: boolean | null
  /** `status='cancelled'`。行は残すが選択できない。 */
  cancelled: boolean
  /**
   * 一括操作の可否判定に使う生の進行状態。**フェーズ1語が既にこれを畳んだ結果**
   * なので一般会員へ渡っても新しい情報にはならない（要件 §3.2.3 は申込状態・
   * 支払状態を行の情報として挙げている）。管理情報（振込総額・振込先・申込書等）は
   * ここに含めない（AC-2）。
   */
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  paymentType: 'advance' | 'onsite' | null
  paymentStatus: 'unpaid' | 'paid'
}

const PHASE_TONE_CLASS: Record<DayPhaseTone, string> = {
  action: 'text-accent-fg font-bold',
  done: 'text-brand-fg',
  wait: 'text-neutral-fg',
  na: 'text-ink-muted',
}

export interface GroupDayTableProps {
  rows: readonly GroupDayRow[]
  /** false なら選択チェックと一括操作バーを描かない（一般会員）。 */
  isAdmin: boolean
  /**
   * グループに `linked` な LINE 連携があるか。通知を伴う操作の前に確認を出す
   * （既存 `EventLifecycleSection` と同一の文言・条件）。
   */
  isLineLinked: boolean
  setEntriesAppliedAction: (eventIds: number[], applied: boolean) => Promise<void>
  setEntriesNotApplyingAction: (eventIds: number[]) => Promise<void>
  setPaymentsPaidAction: (eventIds: number[], paid: boolean) => Promise<void>
  setPaymentTypesAction: (
    eventIds: number[],
    type: 'advance' | 'onsite' | null,
  ) => Promise<void>
}

export function GroupDayTable({
  rows,
  isAdmin,
  isLineLinked,
  setEntriesAppliedAction,
  setEntriesNotApplyingAction,
  setPaymentsPaidAction,
  setPaymentTypesAction,
}: GroupDayTableProps) {
  const selectableIds = rows.filter((r) => !r.cancelled).map((r) => r.id)
  // 既定は「選択可能な日すべてにチェック」（要件 §3.2.5）。
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(selectableIds),
  )
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const selectedRows = rows.filter((r) => !r.cancelled && selected.has(r.id))
  const selectedIds = selectedRows.map((r) => r.id)
  const hasSelection = selectedIds.length > 0

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 通知を伴う操作は、`EventLifecycleSection` が日ページで確立した確認文言を
   * そのまま使う（要件 §3.2.5「LINE 通知は現行の集約規則をそのまま維持する」）。
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
   * 「申し込まない」は LINE 通知こそ飛ばないが、大会申込一覧からの不可視化を伴う。
   * 既存の単一版（`EventLifecycleSection.runNotApplying`）と同じく、`isLineLinked`
   * に関係なく常に確認する。
   */
  function runNotApplying() {
    setError(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        '選択した日は大会申込一覧に表示されなくなります。よろしいですか？',
      )
      if (!ok) return
    }
    startTransition(async () => {
      try {
        await setEntriesNotApplyingAction(selectedIds)
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  // ボタンの活性は「選択した日のうち1日でも状態が動くか」で決める（no-op の
  // Server Action を撃たないため）。判定条件は各アクションのガード付き UPDATE
  // （`WHERE 旧状態`）と対になっている。
  const canApply = selectedRows.some((r) => r.entryStatus === 'not_applied')
  const canPay = selectedRows.some(
    (r) => r.paymentType === 'advance' && r.paymentStatus === 'unpaid',
  )
  const canUnapply = selectedRows.some((r) => r.entryStatus !== 'not_applied')
  const canNotApplying = selectedRows.some((r) => r.entryStatus !== 'not_applying')
  const canUnpay = selectedRows.some(
    (r) => r.paymentType === 'advance' && r.paymentStatus === 'paid',
  )

  return (
    <>
      <ul className="w-full">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              'flex min-w-0 items-baseline gap-2 border-t border-border-soft first:border-t-0',
              // 中止は色を足さず opacity で落とす（design-spec §8）。
              row.cancelled && 'opacity-55',
            )}
          >
            {isAdmin && (
              <input
                type="checkbox"
                // チェックは行リンクの**外**の独立したタップ標的（design-spec §7）。
                className="h-[17px] w-[17px] flex-none self-center rounded-xs border border-border-strong accent-brand disabled:opacity-60"
                checked={selected.has(row.id)}
                disabled={row.cancelled || isPending}
                onChange={() => toggle(row.id)}
                aria-label={`${formatEventDate(row.eventDate)} ${row.name} を選択`}
              />
            )}
            <Link
              href={`/events/${row.id}`}
              className="flex min-w-0 flex-1 items-baseline gap-2 py-[9px]"
            >
              <span className="w-[60px] flex-none whitespace-nowrap text-xs tabular-nums text-ink-2">
                {formatEventDate(row.eventDate)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {row.name}
              </span>
              {/* 級は絶対に truncate しない — 長い大会名のとき日を見分ける
                  唯一の手がかりになる（design-spec §8 / edge-cases ⑤）。 */}
              <span className="flex-none whitespace-nowrap font-mono text-xs text-ink-meta">
                {row.gradesLabel}
              </span>
              <span
                className={cn(
                  'w-[14px] flex-none self-center text-center text-[10px] leading-none',
                  row.myAttend ? 'text-brand' : 'text-ink-muted',
                )}
              >
                {row.myAttend === true ? '●' : row.myAttend === false ? '−' : ''}
              </span>
              <span
                className={cn(
                  'w-[62px] flex-none whitespace-nowrap text-right text-xs',
                  PHASE_TONE_CLASS[row.phaseTone],
                )}
              >
                {row.phaseLabel}
              </span>
              <span className="w-[34px] flex-none whitespace-nowrap text-right text-xs tabular-nums text-ink-meta">
                {row.attendCount}名
              </span>
              <span className="flex-none text-[10px] text-ink-muted" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="mt-[13px] border-t border-border pt-[11px]">
          <div className="flex items-baseline justify-between gap-2 text-xs text-ink-meta">
            <span>
              <span className="font-medium tabular-nums text-ink-2">
                {selectedIds.length}日
              </span>
              を選択中
            </span>
            <span className="flex gap-2.5">
              <button
                type="button"
                className="text-xs text-brand"
                onClick={() => setSelected(new Set(selectableIds))}
              >
                全選択
              </button>
              <button
                type="button"
                className="text-xs text-brand"
                onClick={() => setSelected(new Set())}
              >
                解除
              </button>
            </span>
          </div>

          <div className="mt-[9px] flex flex-wrap items-center gap-2">
            <Btn
              type="button"
              size="sm"
              className="h-[30px] rounded-md"
              disabled={!hasSelection || !canApply || isPending}
              onClick={() => run(() => setEntriesAppliedAction(selectedIds, true), true)}
            >
              申込済にする
            </Btn>
            <Btn
              type="button"
              size="sm"
              className="h-[30px] rounded-md"
              disabled={!hasSelection || !canPay || isPending}
              onClick={() => run(() => setPaymentsPaidAction(selectedIds, true), true)}
            >
              支払済にする
            </Btn>
          </div>

          <div className="mt-[9px] flex items-baseline gap-[9px] text-xs text-ink-meta">
            <span>支払タイプ</span>
            <select
              className="border-b border-border-strong bg-transparent px-px py-0.5 text-[13px] text-ink"
              value=""
              disabled={!hasSelection || isPending}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') return
                const next =
                  raw === 'unset' ? null : (raw as 'advance' | 'onsite')
                e.target.value = ''
                run(() => setPaymentTypesAction(selectedIds, next), false)
              }}
            >
              <option value="">変更する…</option>
              <option value="unset">未設定</option>
              <option value="advance">事前払い</option>
              <option value="onsite">現地払い</option>
            </select>
          </div>

          {/* 後退3種は「戻す操作」に畳んで誤操作を1段遠ざける（design-spec §3）。 */}
          <details className="mt-[9px] border-t border-border-soft [&[open]>summary]:before:content-['▾']">
            <summary className="flex cursor-pointer list-none items-baseline gap-[9px] py-[10px] before:flex-none before:content-['▸'] before:text-[10px] before:text-ink-meta [&::-webkit-details-marker]:hidden">
              <span className="flex-none text-xs text-ink-meta">戻す操作</span>
              <span className="text-[13px] text-ink">
                未申込・申し込まない・未払
              </span>
            </summary>
            <div className="pl-3">
              <div className="mt-[9px] flex flex-wrap items-center gap-2">
                <Btn
                  type="button"
                  kind="secondary"
                  size="sm"
                  className="h-[30px] rounded-md"
                  disabled={!hasSelection || !canUnapply || isPending}
                  onClick={() =>
                    run(() => setEntriesAppliedAction(selectedIds, false), false)
                  }
                >
                  未申込に戻す
                </Btn>
                <Btn
                  type="button"
                  kind="secondary"
                  size="sm"
                  className="h-[30px] rounded-md"
                  disabled={!hasSelection || !canNotApplying || isPending}
                  onClick={runNotApplying}
                >
                  申し込まない
                </Btn>
                <Btn
                  type="button"
                  kind="secondary"
                  size="sm"
                  className="h-[30px] rounded-md"
                  disabled={!hasSelection || !canUnpay || isPending}
                  onClick={() =>
                    run(() => setPaymentsPaidAction(selectedIds, false), false)
                  }
                >
                  未払に戻す
                </Btn>
              </div>
            </div>
          </details>

          {error ? <p className="pt-2 text-xs text-danger-fg">{error}</p> : null}
        </div>
      )}
    </>
  )
}
