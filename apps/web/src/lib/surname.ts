/**
 * Extract the surname for a participant chip.
 *
 * Splits the display name (`users.name`) on the first ASCII or full-width space
 * and returns the leading segment. Names without a space are returned whole.
 * A null/empty name yields `?` (matches the event detail page's original
 * behaviour so the list and detail chips stay identical).
 *
 * Shared by the event list (`/events`) and the event detail (`/events/[id]`)
 * so both derive the same chip label from a single source.
 */
export function surname(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.split(/[\s　]/)
  return parts[0] || name
}
