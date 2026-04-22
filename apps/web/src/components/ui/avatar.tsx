import { AVATAR_COLORS } from './avatar-colors'

export interface AvatarMember {
  id: number
  name: string
}

export interface AvatarProps {
  /** Member to render. When `null`, nothing is rendered (null return). */
  member: AvatarMember | null
  /** Pixel size of the circular chip. Defaults to 28 to match primitives.jsx. */
  size?: number
}

/**
 * Initial-letter avatar chip with deterministic tinted background.
 *
 * Colour is derived from `member.id % AVATAR_COLORS.length`, so the same
 * member always looks the same. Font size scales with `size` to stay
 * readable from 22 px (AvatarStack) up to ~48 px (profile screens).
 */
export function Avatar({ member, size = 28 }: AvatarProps) {
  if (!member) return null
  // AVATAR_COLORS is a fixed-length tuple; modulo guarantees in-range, but
  // noUncheckedIndexedAccess widens the result — assert instead of null-check.
  const pair = AVATAR_COLORS[member.id % AVATAR_COLORS.length]!
  const [bg, fg] = pair
  const initial = member.name.slice(0, 1)
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.45),
      }}
    >
      {initial}
    </div>
  )
}
