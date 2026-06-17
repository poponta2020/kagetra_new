import { describe, it, expect } from 'vitest'
import { BROADCAST_LEAD_PRESETS, LEAD_TEXT_MAX_LENGTH } from './broadcast-lead-presets'

describe('broadcast-lead-presets', () => {
  it('LEAD_TEXT_MAX_LENGTH は 200', () => {
    expect(LEAD_TEXT_MAX_LENGTH).toBe(200)
  })

  it('プリセットは要件の 6 件で、重複が無い', () => {
    expect(BROADCAST_LEAD_PRESETS).toHaveLength(6)
    expect(new Set(BROADCAST_LEAD_PRESETS).size).toBe(BROADCAST_LEAD_PRESETS.length)
  })

  it('全プリセットが trim 後 1〜LEAD_TEXT_MAX_LENGTH 文字に収まる', () => {
    for (const preset of BROADCAST_LEAD_PRESETS) {
      const len = preset.trim().length
      expect(len).toBeGreaterThanOrEqual(1)
      expect(len).toBeLessThanOrEqual(LEAD_TEXT_MAX_LENGTH)
      // 前後空白を持たない（チップ流し込み時に意図せぬ空白を避ける）
      expect(preset).toBe(preset.trim())
    }
  })
})
