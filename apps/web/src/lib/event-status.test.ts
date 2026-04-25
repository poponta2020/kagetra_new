import { describe, it, expect } from 'vitest'
import { eventStatus } from './event-status'

describe('eventStatus', () => {
  it("returns '公開' + success tone for 'published'", () => {
    expect(eventStatus('published')).toEqual({
      label: '公開',
      tone: 'success',
    })
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

  it("returns '下書き' + neutral tone for 'draft'", () => {
    expect(eventStatus('draft')).toEqual({
      label: '下書き',
      tone: 'neutral',
    })
  })

  it("returns '下書き' + neutral tone for null", () => {
    expect(eventStatus(null)).toEqual({ label: '下書き', tone: 'neutral' })
  })

  it("returns '下書き' + neutral tone for undefined", () => {
    expect(eventStatus(undefined)).toEqual({
      label: '下書き',
      tone: 'neutral',
    })
  })

  it("returns '下書き' + neutral tone for an unknown status string", () => {
    expect(eventStatus('foo')).toEqual({ label: '下書き', tone: 'neutral' })
  })
})
