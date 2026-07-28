import { cn } from '@/lib/utils'

/**
 * entry-form-autofill タスク7 (UI): 3ステップウィザードのステップ表示。
 * design-spec 忠実度チェックリスト: 「ステップ表示は EntryFlow と同じ点＋罫線意匠
 * （done=藍塗り点・now=藍リング点・ラベル now は藍太字）で、カード枠・番号丸を
 * 使わない」——`components/events/detail/EntryFlow.tsx` の意匠を、日付なしの
 * 3ステップ固定版として複製する（あちらは EntryFlowStep という別ドメインの型に
 * 依存しており、このウィザード用に流用できないため独立実装）。
 */
const LABELS = ['テンプレート', '会員', 'メール'] as const

export interface WizardStepsProps {
  current: 1 | 2 | 3
}

const STEP_BASE = cn(
  'relative flex min-w-0 flex-1 flex-col items-center gap-[5px]',
  "before:absolute before:left-0 before:right-1/2 before:top-1 before:h-px before:content-[''] first:before:hidden",
  "after:absolute after:left-1/2 after:right-0 after:top-1 after:h-px after:content-[''] last:after:hidden",
)

export function WizardSteps({ current }: WizardStepsProps) {
  return (
    <div className="flex pb-[12px] pt-[11px]">
      {LABELS.map((label, i) => {
        const stepNo = i + 1
        const done = stepNo < current
        const now = stepNo === current
        return (
          <div
            key={label}
            className={cn(
              STEP_BASE,
              done ? 'before:bg-brand after:bg-brand' : now ? 'before:bg-brand after:bg-border' : 'before:bg-border after:bg-border',
            )}
            aria-current={now ? 'step' : undefined}
          >
            <span
              className={cn(
                'relative z-[1] h-[9px] w-[9px] rounded-full',
                done
                  ? 'bg-brand shadow-[0_0_0_1px_var(--kg-brand)]'
                  : now
                    ? 'bg-canvas shadow-[0_0_0_2px_var(--kg-brand)]'
                    : 'bg-surface shadow-[0_0_0_1px_var(--kg-border-strong)]',
              )}
            />
            <span
              className={cn(
                'whitespace-nowrap text-xs',
                now ? 'font-bold text-brand' : done ? 'text-ink-2' : 'text-ink-meta',
              )}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
