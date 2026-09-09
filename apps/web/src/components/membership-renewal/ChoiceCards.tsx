'use client'

import type { RenewalAnswer } from '@kagetra/shared/types'
import { cn } from '@/lib/utils'

/**
 * `ChoiceCards`（design-spec §4）— S1 の「今年度も登録する／今年度は登録しない」
 * 2 択カード。選択中は `--kg-brand` の 1px 内枠、「登録しない」選択中は
 * `--kg-neutral-fg`（design-spec §8）。
 */
export interface ChoiceCardsProps {
  value: RenewalAnswer
  onChange: (value: RenewalAnswer) => void
  registerHelp?: string
  notRegisterHelp?: string
}

export function ChoiceCards({
  value,
  onChange,
  registerHelp,
  notRegisterHelp,
}: ChoiceCardsProps) {
  return (
    <div className="mt-0.5 flex flex-col gap-2">
      <ChoiceCard
        selected={value === 'register'}
        onClick={() => onChange('register')}
        label="今年度も登録する"
        help={registerHelp}
      />
      <ChoiceCard
        selected={value === 'not_register'}
        outline
        onClick={() => onChange('not_register')}
        label="今年度は登録しない"
        help={notRegisterHelp}
      />
    </div>
  )
}

function ChoiceCard({
  selected,
  outline = false,
  onClick,
  label,
  help,
}: {
  selected: boolean
  outline?: boolean
  onClick: () => void
  label: string
  help?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-[11px] text-left',
        selected
          ? outline
            ? 'border-neutral-fg bg-surface ring-1 ring-inset ring-neutral-fg'
            : 'border-brand bg-surface ring-1 ring-inset ring-brand'
          : 'border-border bg-surface',
      )}
    >
      <span
        className={cn(
          'mt-[3px] h-4 w-4 flex-none rounded-full border',
          selected
            ? outline
              ? 'border-neutral-fg'
              : 'border-brand'
            : 'border-border-strong',
        )}
      >
        {selected && (
          <span
            className={cn(
              'block h-full w-full scale-50 rounded-full',
              outline ? 'bg-neutral-fg' : 'bg-brand',
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {help && <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{help}</span>}
      </span>
    </button>
  )
}
