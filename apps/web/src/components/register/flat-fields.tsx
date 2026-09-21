import type { ReactNode } from 'react'
import { useId } from 'react'

export const UNDERLINE_INPUT_CLASS =
  'w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand'

export function Field({
  label,
  htmlFor,
  asGroup,
  children,
}: {
  label: string
  htmlFor: string
  asGroup?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={asGroup ? undefined : htmlFor}
        className="block text-xs font-medium text-ink-2"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/** 学年（選択のみ・自由入力不可）用のセレクト。requirements R1 の候補以外は選ばせない。 */
export function UnderlineSelect({
  id,
  name,
  value,
  onChange,
  options,
  required,
}: {
  id: string
  name: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  required?: boolean
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand"
    >
      <option value="" disabled>
        選択してください
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}

export function UnderlineInput({
  id,
  name,
  value,
  onChange,
  type = 'text',
  required,
  maxLength,
  inputMode,
  disabled,
  autoComplete,
  className = '',
}: {
  id: string
  name: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  maxLength?: number
  inputMode?: 'numeric' | 'tel'
  disabled?: boolean
  autoComplete?: string
  className?: string
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      required={required}
      maxLength={maxLength}
      inputMode={inputMode}
      disabled={disabled}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-50 ${className}`}
    />
  )
}

export function SegmentGroup({
  name,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  name: string
  ariaLabel: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string; ariaLabel: string }>
}) {
  const groupId = useId()
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1">
      {options.map((opt) => {
        const selected = value === opt.value
        const inputId = `${groupId}-${name}-${opt.value}`
        return (
          <label
            key={opt.value}
            htmlFor={inputId}
            className={`flex-1 cursor-pointer border-b-2 pb-2 pt-1 text-center text-sm transition-colors ${
              selected ? 'border-brand font-semibold text-ink' : 'border-border text-ink-meta'
            }`}
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              aria-label={opt.ariaLabel}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        )
      })}
    </div>
  )
}

export function BoxlessCheckbox({
  name,
  checked,
  onChange,
  label,
  small,
}: {
  name?: string
  checked: boolean
  onChange: (c: boolean) => void
  label: string
  small?: boolean
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 ${small ? 'text-xs text-ink-meta' : 'text-sm text-ink-2'}`}>
      <input
        type="checkbox"
        name={name}
        value="on"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-brand"
      />
      {label}
    </label>
  )
}
