import { describe, it, expect } from 'vitest'
import { eventFormSchema } from './form-schemas'

const baseInput = {
  title: '基本',
  eventDate: '2030-06-15',
  status: 'draft' as const,
  kind: 'individual' as const,
  official: true,
}

describe('eventFormSchema', () => {
  it('feeJpy=0 を非負整数として受理する (無料大会)', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, feeJpy: '0' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.feeJpy).toBe(0)
  })

  it('feeJpy=空文字 は null に変換される', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, feeJpy: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.feeJpy).toBeNull()
  })

  it('feeJpy=負数 は弾く', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, feeJpy: '-1' })
    expect(result.success).toBe(false)
  })

  it('capacity=0 は positive 制約で弾く (定員0は無意味)', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, capacity: '0' })
    expect(result.success).toBe(false)
  })

  it('eventGroupId=0 は positive 制約で弾く', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, eventGroupId: '0' })
    expect(result.success).toBe(false)
  })
})
