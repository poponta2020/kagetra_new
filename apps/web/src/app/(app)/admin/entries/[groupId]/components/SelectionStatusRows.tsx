'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Btn } from '@/components/ui'
import { DisclosureActions, DisclosureRow, LinkAction } from '@/components/events/detail'
import type { TravelSelectionStatus } from '@kagetra/shared'

/**
 * S5 名簿セクション「確定状況」の1行ぶんの表示 DTO
 * （`@/lib/travel-report/selection-status` の `SelectionStatusRow` と同形）。
 */
export interface SelectionStatusRowView {
  userId: string
  name: string | null
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  isGuest: boolean
  status: TravelSelectionStatus
}

export interface SelectionStatusRowsProps {
  entryGroupId: number
  /** 出欠「参加」の会員・ゲストごとの現在の確定状況（初期表示は有効値の導出結果）。 */
  rows: readonly SelectionStatusRowView[]
  saveAction: (
    entryGroupId: number,
    updates: { userId: string; status: TravelSelectionStatus }[],
  ) => Promise<void>
  resetAction: (entryGroupId: number) => Promise<void>
}

const STATUS_OPTIONS: readonly { value: TravelSelectionStatus; label: string }[] = [
  { value: 'confirmed', label: '確定' },
  { value: 'waitlisted', label: 'ｷｬﾝｾﾙ待ち' },
  { value: 'not_participating', label: '不参加' },
]

const STATUS_LABEL: Record<TravelSelectionStatus, string> = {
  confirmed: '確定',
  waitlisted: 'キャンセル待ち',
  not_participating: '不参加',
}

// design-spec §4/§8: 選択色は 確定＝brand／キャンセル待ち＝warn／不参加＝neutral-fg。
// いずれも選択中の文字色は `ink-on-brand`（mock の `--kg-fg-on-brand` に対応）。
const SELECTED_CLASS: Record<TravelSelectionStatus, string> = {
  confirmed: 'bg-brand text-ink-on-brand font-semibold',
  waitlisted: 'bg-warn text-ink-on-brand font-semibold',
  not_participating: 'bg-neutral-fg text-ink-on-brand font-semibold',
}

function rowsSignature(rows: readonly SelectionStatusRowView[]): string {
  return rows.map((r) => `${r.userId}:${r.status}`).join('|')
}

function summaryLabel(statuses: readonly TravelSelectionStatus[]): string {
  const countOf = (s: TravelSelectionStatus) => statuses.filter((v) => v === s).length
  return `確定 ${countOf('confirmed')} ・ キャンセル待ち ${countOf('waitlisted')} ・ 不参加 ${countOf('not_participating')}`
}

/**
 * S5 名簿セクションの「確定状況」開閉行（requirements R3・AC-8/AC-9。
 * design-spec §3/§4/§8）。1人1行＋3択セグメント。「取込名簿の結果に戻す」と
 * 「確定状況を保存」を右寄せで並べる。
 *
 * ★配置は `RosterSection` の `selectionStatusSlot`（design-spec §8「名簿セクション
 * **内**の開閉行」）。兄弟要素として並べると名簿を閉じている間もこの行だけ見えて
 * しまうため、スロットで中へ差し込む。ここは表示・編集・保存の責務だけを持つ。
 *
 * 対象が 0 人（出欠「参加」の会員・ゲストがいない）なら何も描画しない。
 */
export function SelectionStatusRows({
  entryGroupId,
  rows,
  saveAction,
  resetAction,
}: SelectionStatusRowsProps) {
  const [statusByUserId, setStatusByUserId] = useState<Record<string, TravelSelectionStatus>>(() =>
    Object.fromEntries(rows.map((r) => [r.userId, r.status])),
  )
  // props.rows が Server Component の再検証（保存・初期化のあと）で更新されたら
  // ローカル編集を作り直す。`PaymentNoticeSection` と同じ「署名を比較して
  // レンダー中に state を調整する」パターン（useEffect だと1レンダー遅れる）。
  const [prevSignature, setPrevSignature] = useState(() => rowsSignature(rows))
  const nextSignature = rowsSignature(rows)
  if (nextSignature !== prevSignature) {
    setPrevSignature(nextSignature)
    setStatusByUserId(Object.fromEntries(rows.map((r) => [r.userId, r.status])))
  }

  const [isSaving, startSaving] = useTransition()
  const [isResetting, startResetting] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (rows.length === 0) return null

  const valueOf = (userId: string, fallback: TravelSelectionStatus) =>
    statusByUserId[userId] ?? fallback
  const currentStatuses = rows.map((r) => valueOf(r.userId, r.status))
  const busy = isSaving || isResetting

  function onSave() {
    setError(null)
    startSaving(async () => {
      try {
        await saveAction(
          entryGroupId,
          rows.map((r) => ({ userId: r.userId, status: valueOf(r.userId, r.status) })),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    })
  }

  function onReset() {
    setError(null)
    startResetting(async () => {
      try {
        await resetAction(entryGroupId)
      } catch (e) {
        setError(e instanceof Error ? e.message : '初期化に失敗しました')
      }
    })
  }

  return (
    <DisclosureRow
      label="確定状況"
      value={summaryLabel(currentStatuses)}
      aux="取込名簿から初期化"
      defaultOpen
    >
      <p className="pb-1.5 text-xs leading-[1.75] text-ink-meta">
        出欠「参加」の人ごとに設定します。遠征届の対象は「確定」の人だけです。キャンセル待ちが繰り上がったら「確定」に変えてください。
      </p>
      <div>
        {rows.map((row) => {
          const value = valueOf(row.userId, row.status)
          const personLabel = row.name ?? '（名前未設定）'
          return (
            <div
              key={row.userId}
              className="flex items-center gap-2 border-t border-border-soft py-[7px] first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {row.name ?? '?'}
                {row.grade && (
                  <span className="ml-1 font-mono text-xs text-ink-meta">{row.grade}</span>
                )}
                {row.isGuest && (
                  <span className="ml-[3px] text-[10px] text-ink-meta">ゲスト</span>
                )}
              </span>
              <span
                role="radiogroup"
                aria-label={`${personLabel}の確定状況`}
                className="inline-flex flex-none overflow-hidden rounded-md border border-border-strong"
              >
                {STATUS_OPTIONS.map((opt) => {
                  const selected = value === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${personLabel}を${STATUS_LABEL[opt.value]}にする`}
                      disabled={busy}
                      onClick={() =>
                        setStatusByUserId((prev) => ({ ...prev, [row.userId]: opt.value }))
                      }
                      className={cn(
                        'border-l border-border-strong px-2 py-[3px] text-[11px] text-ink-meta first:border-l-0 disabled:opacity-50',
                        selected && SELECTED_CLASS[opt.value],
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </span>
            </div>
          )
        })}
      </div>
      <DisclosureActions>
        <LinkAction disabled={busy} onClick={onReset}>
          取込名簿の結果に戻す
        </LinkAction>
        <Btn kind="primary" size="sm" disabled={busy} onClick={onSave}>
          確定状況を保存
        </Btn>
      </DisclosureActions>
      {error && (
        <p role="alert" className="mt-1.5 text-right text-xs text-accent-fg">
          {error}
        </p>
      )}
    </DisclosureRow>
  )
}
