import { describe, it, expect } from 'vitest'
import { eventFormSchema, extractEventFormData, extractEventUnitsFormData } from './form-schemas'

const baseInput = {
  title: '基本',
  eventDate: '2030-06-15',
  status: 'published' as const,
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

  // entry-notify-lottery-treasurer -----------------------------------------
  it('lotteryDate=YYYY-MM-DD は受理する', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, lotteryDate: '2026-01-20' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.lotteryDate).toBe('2026-01-20')
  })

  it('lotteryDate=空文字 は null に変換される（=抽選なし）', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, lotteryDate: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.lotteryDate).toBeNull()
  })

  it('lotteryDate=undefined（フィールド未送信）も null に変換される', () => {
    const result = eventFormSchema.safeParse(baseInput)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.lotteryDate).toBeNull()
  })

  it('lotteryDate=不正形式は弾く', () => {
    const result = eventFormSchema.safeParse({ ...baseInput, lotteryDate: '2026/01/20' })
    expect(result.success).toBe(false)
  })

  // draft 廃止: status enum は 3 値 (published/cancelled/done) のみ。 ------------
  it.each(['published', 'cancelled', 'done'] as const)(
    "status='%s' を受理する",
    (status) => {
      const result = eventFormSchema.safeParse({ ...baseInput, status })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.status).toBe(status)
    },
  )

  it("status='draft' は enum から外れたので弾く", () => {
    const result = eventFormSchema.safeParse({ ...baseInput, status: 'draft' })
    expect(result.success).toBe(false)
  })
})

describe('extractEventFormData', () => {
  it("status 未送信なら既定 'published' に解決される（draft 廃止）", () => {
    const fd = new FormData()
    fd.set('title', 'X')
    fd.set('eventDate', '2030-06-15')
    const parsed = eventFormSchema.parse(extractEventFormData(fd))
    expect(parsed.status).toBe('published')
  })

  it('lotteryDate を formData から拾い、空文字なら null にパースされる', () => {
    const fd = new FormData()
    fd.set('title', 'X')
    fd.set('eventDate', '2030-06-15')
    fd.set('status', 'published')
    fd.set('lotteryDate', '2026-01-20')
    const parsed = eventFormSchema.parse(extractEventFormData(fd))
    expect(parsed.lotteryDate).toBe('2026-01-20')

    const fd2 = new FormData()
    fd2.set('title', 'X')
    fd2.set('eventDate', '2030-06-15')
    fd2.set('status', 'published')
    fd2.set('lotteryDate', '')
    const parsed2 = eventFormSchema.parse(extractEventFormData(fd2))
    expect(parsed2.lotteryDate).toBeNull()
  })
})

describe('extractEventUnitsFormData (承認画面)', () => {
  it('承認画面では lotteryDate を渡さない → zod パース後は null（要件 §5.2: 承認直後は NULL）', () => {
    const fd = new FormData()
    fd.append('unit_key', 'u1')
    fd.set('u1__register', 'on')
    fd.set('u1__title', '春の大会')
    fd.set('u1__eventDate', '2030-06-15')
    // draft 廃止: 承認画面でも status 入力は描画されない（mode="create"）。
    // extract は未送信→既定 'published' に解決する。
    // 仮に承認画面 form 側に lotteryDate を出してしまっても、extract が読まないので無視される。
    fd.set('u1__lotteryDate', '2026-01-20')

    const units = extractEventUnitsFormData(fd)
    expect(units).toHaveLength(1)
    expect(units[0]!.data).not.toHaveProperty('lotteryDate')
    // status 未送信でも既定 published（承認＝公開作成）。
    expect(units[0]!.data.status).toBe('published')

    const parsed = eventFormSchema.parse(units[0]!.data)
    expect(parsed.status).toBe('published')
    expect(parsed.lotteryDate).toBeNull()
  })
})
