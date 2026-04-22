import { Avatar, type AvatarMember } from './avatar'

export interface AvatarStackProps {
  members: AvatarMember[]
  /** Maximum avatars to render before collapsing into a `+N` badge. */
  max?: number
  /** Pixel diameter of each avatar. */
  size?: number
}

/**
 * Row of overlapping initial-letter avatars with optional overflow badge.
 *
 * Accepts a `members` array (diverging from primitives.jsx's `ids`) so
 * callers don't have to resolve members separately. The surface ring is
 * applied via `box-shadow` using the `--kg-surface` CSS variable so chips
 * read cleanly over any parent background.
 */
export function AvatarStack({ members, max = 5, size = 22 }: AvatarStackProps) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  const overflowFontSize = Math.round(size * 0.4)

  return (
    <div className="flex items-center">
      {shown.map((member, i) => (
        <div
          key={member.id}
          className="rounded-full"
          style={{
            marginLeft: i === 0 ? 0 : -6,
            boxShadow: '0 0 0 1.5px var(--kg-surface)',
          }}
        >
          <Avatar member={member} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="flex items-center justify-center rounded-full font-semibold bg-neutral-bg text-neutral-fg flex-shrink-0"
          style={{
            width: size,
            height: size,
            marginLeft: -6,
            fontSize: overflowFontSize,
            boxShadow: '0 0 0 1.5px var(--kg-surface)',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}
