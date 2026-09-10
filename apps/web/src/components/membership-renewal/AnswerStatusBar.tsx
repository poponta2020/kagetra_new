'use client'

import { cn } from '@/lib/utils'

/**
 * `AnswerStatusBar`（design-spec §4・§8）— S1 上部の回答状態バー。
 * 未回答＝`--kg-accent` 枠＋`--kg-accent-bg`、回答済み＝`--kg-border` 枠＋
 * `--kg-surface`（design-spec §8 の忠実度チェック項目）。
 */
export interface AnswerStatusBarProps {
  answered: boolean
  /** `.at`（要約。例「今年度も登録する ・ 4年」「全日協の登録と 4月からの学年」）。 */
  summary: string
  /** `.as`（副行。締切までの日数、または回答日時＋変更概要）。 */
  sub: string
  /** 回答済みのときだけ渡す「修正」リンク（未回答時は渡さない）。 */
  onEdit?: () => void
}

export function AnswerStatusBar({ answered, summary, sub, onEdit }: AnswerStatusBarProps) {
  return (
    <div
      className={cn(
        'mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2.5',
        answered ? 'border-border bg-surface' : 'border-accent bg-accent-bg',
      )}
    >
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center rounded-[5px] px-[7px] text-[11px] font-semibold',
          answered ? 'bg-brand-bg text-brand-fg' : 'bg-accent-bg text-accent-fg',
        )}
      >
        {answered ? '回答済み' : '未回答'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">{summary}</span>
        <span
          className={cn('mt-0.5 block text-xs', answered ? 'text-ink-meta' : 'text-accent-fg')}
        >
          {sub}
        </span>
      </span>
      {answered && onEdit && (
        <button type="button" onClick={onEdit} className="shrink-0 text-xs text-brand">
          修正
        </button>
      )}
    </div>
  )
}
