import type { ComponentPropsWithoutRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export type LinkActionTone = 'brand' | 'danger'

const TONE_CLASS: Record<LinkActionTone, string> = {
  brand: 'text-brand',
  danger: 'text-accent-fg',
}

/**
 * テキストリンク型アクションの見た目クラス（12px・色のみ）＋タップ領域拡張。
 * 拡張は `::before` の絶対配置なのでレイアウトを一切動かさない
 * （design-spec §10 の受容済みリスクへの対処）。
 * `text-xs` の行高 16px（Tailwind v4 既定）＋ 上下 13px ずつの拡張で
 * 概算 42px 相当（iOS 推奨 44px にはわずかに届かない。実測は未検証）。
 */
export function linkActionClass(tone: LinkActionTone = 'brand', extra?: string) {
  return cn(
    'relative inline-block whitespace-nowrap text-xs',
    "before:absolute before:inset-x-0 before:-inset-y-[13px] before:content-['']",
    TONE_CLASS[tone],
    extra,
  )
}

export type LinkActionProps = ComponentPropsWithoutRef<'button'> & {
  tone?: LinkActionTone
}

/**
 * テキストリンク型アクション（button ベース）。進行管理・LINE 配信の
 * Server Action から `formAction` 付きで使われることを想定し、
 * `disabled` / `onClick` / `type="submit"` / `formAction` をそのまま通す。
 */
export function LinkAction({
  tone = 'brand',
  className,
  type = 'button',
  ...rest
}: LinkActionProps) {
  return (
    <button type={type} className={linkActionClass(tone, className)} {...rest} />
  )
}

export type LinkActionLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  tone?: LinkActionTone
}

/** next/link 用のテキストリンク型アクション（「編集」等の遷移リンク）。 */
export function LinkActionLink({
  tone = 'brand',
  className,
  ...rest
}: LinkActionLinkProps) {
  return <Link className={linkActionClass(tone, className)} {...rest} />
}
