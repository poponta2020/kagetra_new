import { describe, it, expect } from 'vitest'
import { eventStatus } from './event-status'

describe('eventStatus', () => {
  // draft 廃止: 通常状態 (published) はピルを出さない（null）。
  it("returns null (no pill) for 'published'", () => {
    expect(eventStatus('published')).toBeNull()
  })

  it("returns '中止' + danger tone for 'cancelled'", () => {
    expect(eventStatus('cancelled')).toEqual({
      label: '中止',
      tone: 'danger',
    })
  })

  it("returns '終了' + info tone for 'done'", () => {
    expect(eventStatus('done')).toEqual({ label: '終了', tone: 'info' })
  })

  it('returns null (no pill) for null', () => {
    expect(eventStatus(null)).toBeNull()
  })

  it('returns null (no pill) for undefined', () => {
    expect(eventStatus(undefined)).toBeNull()
  })

  it('returns null (no pill) for an unknown status string', () => {
    expect(eventStatus('foo')).toBeNull()
  })
})
