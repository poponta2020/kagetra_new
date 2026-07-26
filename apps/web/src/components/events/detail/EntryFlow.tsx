import { cn } from '@/lib/utils'
import { formatFlowDate } from '@/lib/event-date'
import type { EntryFlowStep } from '@/lib/events/entry-flow'

/**
 * 申込フロー（会内締切→大会申込→抽選→支払→開催）の横一列表示。
 * 判定は `buildEntryFlow`（`@/lib/events/entry-flow`）が済ませており、ここは
 * 描画専用。箱を使わず点・罫線・タイポだけで組む（design-spec の脱カード方針）。
 *
 * done / now / warn / goal は合成可能な独立フラグで、**優先順位はモック CSS の
 * 宣言順と同じ** — base → done → now → warn → goal（goal が最後＝最強）。
 * 「開催は完了していても goal の見た目を保つ」という design-spec の指定が
 * これで表現される。
 *
 * クラスは必ず `cn`（tailwind-merge）で重ねる。同じプロパティのユーティリティを
 * 素の文字列連結で並べると、勝つ方が className の順ではなく生成 CSS の順で
 * 決まってしまい制御できない。
 */

const STEP_BASE = cn(
  'relative flex min-w-0 flex-1 flex-col items-center gap-[5px]',
  // ステップ間をつなぐ罫線。点の中心（top 4px）に合わせて左半分＝before /
  // 右半分＝after に分け、両端の外側だけ隠す。
  "before:absolute before:left-0 before:right-1/2 before:top-1 before:h-px before:content-[''] first:before:hidden",
  "after:absolute after:left-1/2 after:right-0 after:top-1 after:h-px after:content-[''] last:after:hidden",
)

const DOT_BASE = 'relative z-[1] rounded-full'
const DOT_SIZE = 'h-[9px] w-[9px]'
const LABEL_BASE = 'whitespace-nowrap text-xs text-neutral-fg'
const DATE_BASE = 'text-xs text-ink-meta tabular-nums'

/** 通過済みの区間だけ藍にする。now は「そこまで来た」ので左半分のみ藍。 */
function connectorClass(step: EntryFlowStep): string {
  if (step.done) return 'before:bg-brand after:bg-brand'
  if (step.isNow) return 'before:bg-brand after:bg-border'
  return 'before:bg-border after:bg-border'
}

function dotClass(step: EntryFlowStep): string {
  if (step.isGoal) {
    return cn(DOT_BASE, 'h-[11px] w-[11px] bg-canvas shadow-[0_0_0_1.5px_var(--kg-fg-2)]')
  }
  // warn は box-shadow だけを朱に差し替える（背景は base / now から引き継ぐ）。
  if (step.isWarn) {
    return cn(
      DOT_BASE,
      DOT_SIZE,
      step.isNow ? 'bg-canvas' : 'bg-surface',
      'shadow-[0_0_0_1px_var(--kg-accent)]',
    )
  }
  if (step.isNow) return cn(DOT_BASE, DOT_SIZE, 'bg-canvas shadow-[0_0_0_2px_var(--kg-brand)]')
  if (step.done) return cn(DOT_BASE, DOT_SIZE, 'bg-brand shadow-[0_0_0_1px_var(--kg-brand)]')
  return cn(DOT_BASE, DOT_SIZE, 'bg-surface shadow-[0_0_0_1px_var(--kg-border-strong)]')
}

function labelClass(step: EntryFlowStep): string {
  if (step.isGoal) return cn(LABEL_BASE, 'font-bold text-ink')
  if (step.isWarn) return cn(LABEL_BASE, step.isNow && 'font-bold', 'text-accent-fg')
  if (step.isNow) return cn(LABEL_BASE, 'font-bold text-brand')
  return LABEL_BASE
}

export interface EntryFlowProps {
  steps: readonly EntryFlowStep[]
  className?: string
}

export function EntryFlow({ steps, className }: EntryFlowProps) {
  return (
    <div className={cn('flex pb-[12px] pt-[11px]', className)}>
      {steps.map((step) => (
        <div
          key={step.key}
          className={cn(STEP_BASE, connectorClass(step))}
          aria-current={step.isNow ? 'step' : undefined}
        >
          <span className={dotClass(step)} />
          <span className={labelClass(step)}>{step.label}</span>
          {/* 数値でない「未定」「申込なし」「現地払い」は Serif にせず sans で出す
              （design-spec §8 の忠実度チェックリスト）。 */}
          <span
            className={cn(DATE_BASE, step.date.kind === 'date' ? 'font-display' : 'font-sans')}
          >
            {step.date.kind === 'date' ? formatFlowDate(step.date.value) : step.date.value}
          </span>
        </div>
      ))}
    </div>
  )
}
