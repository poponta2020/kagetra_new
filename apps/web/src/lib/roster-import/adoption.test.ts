import { describe, expect, it } from 'vitest'
import { resolveASelectionRule } from './adoption'

describe('resolveASelectionRule', () => {
  it('selects the evidence-backed rule only within its effective period', () => {
    expect(resolveASelectionRule('2024-03-31')).toBeNull()
    expect(resolveASelectionRule('2024-04-01')).toEqual({
      version: 'ajka-a-priority-2024-v1',
      evidence: 'requirements:tournament-lottery-trends#2024-a-grade-priority-notice',
    })
    expect(resolveASelectionRule('2026-03-31')?.version).toBe('ajka-a-priority-2024-v1')
    expect(resolveASelectionRule('2026-04-01')).toBeNull()
  })
})
