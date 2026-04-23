import type { PillTone } from '@/components/ui'

export interface RoleLabelResult {
  label: string
  tone: PillTone
}

/**
 * Map a user role string to a display label + Pill tone.
 *
 * Admin/vice-admin use the brand tone; everything else (including
 * null/undefined and any unknown string) falls back to the neutral
 * 会員 label so missing data never surfaces a broken UI.
 */
export function roleLabel(
  role: string | null | undefined,
): RoleLabelResult {
  switch (role) {
    case 'admin':
      return { label: '管理者', tone: 'brand' }
    case 'vice_admin':
      return { label: '副管理者', tone: 'brand' }
    default:
      return { label: '会員', tone: 'neutral' }
  }
}
