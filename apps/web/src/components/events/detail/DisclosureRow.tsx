import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type DisclosureValueTone = 'plain' | 'ok' | 'ng'
export type DisclosureAuxTone = 'meta' | 'warn'

const VALUE_TONE_CLASS: Record<DisclosureValueTone, string> = {
  plain: 'text-[13px] text-ink',
  ok: 'text-[15px] font-bold text-brand-fg',
  ng: 'text-[15px] font-bold text-accent-fg',
}

const AUX_TONE_CLASS: Record<DisclosureAuxTone, string> = {
  meta: 'text-ink-meta',
  warn: 'text-accent-fg',
}

/**
 * `<summary>` の開閉マーカー（▸/▾）＋見出しの共通クラス。`group-open:` は
 * 親の `<details className="group">` の open 属性に応じて切り替わる。
 */
const MARKER_BEFORE_CLASS =
  "before:content-['▸'] before:flex-none before:text-[10px] before:text-ink-meta group-open:before:content-['▾']"

function bodyClass(nested: boolean) {
  return nested ? 'pl-3' : 'pt-[2px] pb-[13px]'
}

export interface DisclosureRowProps {
  /** .k（12px ink-meta）。 */
  label: ReactNode
  /** .v（既定 13px ink）。 */
  value: ReactNode
  /** 'plain' | 'ok' | 'ng'（既定 'plain'。ok=藍 15px bold / ng=朱 15px bold）。 */
  valueTone?: DisclosureValueTone
  /** .mgaux（右端・ml-auto・12px）。 */
  aux?: ReactNode
  /** 'meta' | 'warn'（既定 'meta'）。 */
  auxTone?: DisclosureAuxTone
  /** 本文を .mgbody.nest（左 12px インデント）にする（既定 false）。 */
  nested?: boolean
  /** ★既定 false。 */
  defaultOpen?: boolean
  className?: string
  children?: ReactNode
}

/**
 * inner バリアント（.mg）。ラベル＋現在値＋右端の補助テキストを持つ
 * `<details>` 行。既定=閉（design-spec §3 の核。ここを開にすると狙いが
 * 消える）。ネイティブ `<details>` なので JS 無しで開閉する
 * （Server Component としても使える）。
 */
export function DisclosureRow({
  label,
  value,
  valueTone = 'plain',
  aux,
  auxTone = 'meta',
  nested = false,
  defaultOpen = false,
  className,
  children,
}: DisclosureRowProps) {
  return (
    <details
      open={defaultOpen || undefined}
      className={cn(
        'group border-t border-border-soft first-of-type:border-t-0',
        className,
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-baseline gap-[9px] py-[10px]',
          '[&::-webkit-details-marker]:hidden',
          MARKER_BEFORE_CLASS,
        )}
      >
        <span className="flex-none text-xs text-ink-meta">{label}</span>
        <span className={VALUE_TONE_CLASS[valueTone]}>{value}</span>
        {aux != null && (
          <span className={cn('ml-auto text-xs', AUX_TONE_CLASS[auxTone])}>
            {aux}
          </span>
        )}
      </summary>
      <div className={bodyClass(nested)}>{children}</div>
    </details>
  )
}

export interface DisclosureSectionProps {
  /** h2（Serif 18px semibold）。 */
  title: ReactNode
  /** .mgaux（右端・ml-auto・12px）。 */
  aux?: ReactNode
  /** 'meta' | 'warn'（既定 'meta'）。 */
  auxTone?: DisclosureAuxTone
  /** 本文を .mgbody.nest（左 12px インデント）にする（既定 false）。 */
  nested?: boolean
  /** ★既定 false。 */
  defaultOpen?: boolean
  className?: string
  children?: ReactNode
}

/**
 * outer バリアント（.mg.outer）。`<summary>` に h2 見出し＋下線。中に
 * {@link DisclosureRow} を入れる。既定=閉。
 */
export function DisclosureSection({
  title,
  aux,
  auxTone = 'meta',
  nested = false,
  defaultOpen = false,
  className,
  children,
}: DisclosureSectionProps) {
  return (
    <details open={defaultOpen || undefined} className={cn('group', className)}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-baseline gap-2 border-b border-border-strong pb-[7px]',
          '[&::-webkit-details-marker]:hidden',
          MARKER_BEFORE_CLASS,
        )}
      >
        <h2 className="font-display text-[18px] font-semibold text-ink">
          {title}
        </h2>
        {aux != null && (
          <span className={cn('ml-auto text-xs', AUX_TONE_CLASS[auxTone])}>
            {aux}
          </span>
        )}
      </summary>
      <div className={bodyClass(nested)}>{children}</div>
    </details>
  )
}

export interface DisclosureActionsProps {
  children: ReactNode
}

/** .mgacts — 本文末尾の右寄せアクション行。 */
export function DisclosureActions({ children }: DisclosureActionsProps) {
  return (
    <div className="mt-[11px] flex items-center justify-end gap-2.5">
      {children}
    </div>
  )
}
