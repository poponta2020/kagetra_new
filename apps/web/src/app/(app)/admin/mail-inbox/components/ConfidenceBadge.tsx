import { Pill } from '@/components/ui'

export interface ConfidenceBadgeProps {
  confidence: number | null
}

/**
 * Displays an LLM self-rated confidence score on tournament announcement
 * extraction. Tone bands:
 *   >= 0.9  → success ("高")
 *   >= 0.5  → warn    ("中")
 *   <  0.5  → neutral ("低")
 *   null    → neutral ("—")  // ai_failed rows
 *
 * Score is shown to 2 decimals so operators can spot drift in the band edges
 * without needing to open the draft detail.
 *
 * Contract is `number | null` only — the DB stores `numeric(3,2)` which
 * drizzle returns as a string, so the caller (DraftCard) does the conversion.
 */
export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  if (confidence === null) {
    return (
      <Pill tone="neutral" size="sm">
        —
      </Pill>
    )
  }
  const tone =
    confidence >= 0.9 ? 'success' : confidence >= 0.5 ? 'warn' : 'neutral'
  const label = confidence >= 0.9 ? '高' : confidence >= 0.5 ? '中' : '低'
  return (
    <Pill tone={tone} size="sm">
      {label} ({confidence.toFixed(2)})
    </Pill>
  )
}
