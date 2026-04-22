import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Conditionally joins Tailwind classes while resolving conflicts via tailwind-merge.
 * Canonical helper for every component under `@/components/ui/*` so callers can
 * safely pass a `className` prop and override base styles.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
