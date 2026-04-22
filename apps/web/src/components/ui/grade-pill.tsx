import { Pill, type PillSize } from './pill'

export interface GradePillProps {
  /** Grade letter (e.g. 'A', 'B'). Rendered as `{grade}級`. */
  grade: string
  size?: PillSize
}

/**
 * Pill variant for competitive かるた grades (A級〜E級). Info tone + mono
 * weight to keep the letter reading as a label rather than prose.
 */
export function GradePill({ grade, size }: GradePillProps) {
  return (
    <Pill tone="info" size={size} className="font-mono font-semibold">
      {grade}級
    </Pill>
  )
}
