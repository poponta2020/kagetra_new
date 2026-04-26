import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ExtractionPayload } from '@kagetra/mail-worker/classify/schema'
import { ApprovalForm } from './ApprovalForm'

const noop = () => {}

/**
 * Build an `ExtractionPayload` whose `extracted` block has every field
 * populated. Defaults below are picked so the displayed values are easy to
 * spot in assertions (e.g. unique title, distinct numeric values).
 */
function buildPayload(
  overrides: Partial<ExtractionPayload['extracted']> = {},
): ExtractionPayload {
  return {
    is_tournament_announcement: true,
    confidence: 0.9,
    reason: 'fixture',
    is_correction: false,
    references_subject: null,
    extracted: {
      title: 'AI-extracted title',
      formal_name: '正式名称',
      event_date: '2030-12-01',
      venue: 'AI 会場',
      fee_jpy: 4500,
      payment_deadline: '2030-11-25',
      payment_info_text: '○○銀行 普通 1234567',
      payment_method: '事前振込',
      entry_method: 'メール申込',
      organizer_text: '主催 X',
      entry_deadline: '2030-11-30',
      eligible_grades: ['A', 'B'],
      kind: 'team',
      capacity_total: 64,
      capacity_a: 32,
      capacity_b: 16,
      capacity_c: 8,
      capacity_d: 4,
      capacity_e: 4,
      official: true,
      ...overrides,
    },
  }
}

describe('ApprovalForm — extracted_payload プリフィル', () => {
  it('extracted の値を EventForm の各フィールドに 1:1 マッピングする', () => {
    const payload = buildPayload()
    const { container } = render(
      <ApprovalForm extractedPayload={payload} groups={[]} action={noop} />,
    )

    // title
    const titleInput = screen.getByDisplayValue(
      'AI-extracted title',
    ) as HTMLInputElement
    expect(titleInput.name).toBe('title')

    // eventDate (mapped from extracted.event_date)
    const dateInput = container.querySelector(
      'input[name="eventDate"]',
    ) as HTMLInputElement
    expect(dateInput.value).toBe('2030-12-01')

    // location (mapped from extracted.venue)
    const locationInput = container.querySelector(
      'input[name="location"]',
    ) as HTMLInputElement
    expect(locationInput.value).toBe('AI 会場')

    // feeJpy (mapped from extracted.fee_jpy)
    const feeInput = container.querySelector(
      'input[name="feeJpy"]',
    ) as HTMLInputElement
    expect(feeInput.value).toBe('4500')

    // capacityA (mapped from extracted.capacity_a)
    const capAInput = container.querySelector(
      'input[name="capacityA"]',
    ) as HTMLInputElement
    expect(capAInput.value).toBe('32')

    // formalName / paymentInfo for breadth
    const formalNameInput = container.querySelector(
      'input[name="formalName"]',
    ) as HTMLInputElement
    expect(formalNameInput.value).toBe('正式名称')
    const paymentInfo = container.querySelector(
      'textarea[name="paymentInfo"]',
    ) as HTMLTextAreaElement
    expect(paymentInfo.value).toBe('○○銀行 普通 1234567')
  })

  it('AI が null を返した値は入力にも空文字 (defaultValue → "") として渡される', () => {
    // Each AI-nullable field is null; EventForm coalesces null → '' for inputs.
    const payload: ExtractionPayload = {
      is_tournament_announcement: true,
      confidence: 0.5,
      reason: 'partial',
      extracted: {
        title: null,
        formal_name: null,
        event_date: null,
        venue: null,
        fee_jpy: null,
        payment_deadline: null,
        payment_info_text: null,
        payment_method: null,
        entry_method: null,
        organizer_text: null,
        entry_deadline: null,
        eligible_grades: null,
        kind: null,
        capacity_total: null,
        capacity_a: null,
        capacity_b: null,
        capacity_c: null,
        capacity_d: null,
        capacity_e: null,
        official: null,
      },
    }
    const { container } = render(
      <ApprovalForm extractedPayload={payload} groups={[]} action={noop} />,
    )

    const titleInput = container.querySelector(
      'input[name="title"]',
    ) as HTMLInputElement
    expect(titleInput.value).toBe('')
    const feeInput = container.querySelector(
      'input[name="feeJpy"]',
    ) as HTMLInputElement
    expect(feeInput.value).toBe('')
    const venueInput = container.querySelector(
      'input[name="location"]',
    ) as HTMLInputElement
    expect(venueInput.value).toBe('')
  })

  it("AI が kind=null を返した場合は EventForm のデフォルト 'individual' に倒す", () => {
    const payload = buildPayload({ kind: null })
    const { container } = render(
      <ApprovalForm extractedPayload={payload} groups={[]} action={noop} />,
    )
    const kindInput = container.querySelector(
      'input[name="kind"]',
    ) as HTMLInputElement
    expect(kindInput).not.toBeNull()
    expect(kindInput.value).toBe('individual')
  })

  it('extractedPayload=null (ai_failed draft 等) でもフォームはレンダリングされる', () => {
    const { container } = render(
      <ApprovalForm extractedPayload={null} groups={[]} action={noop} />,
    )
    const titleInput = container.querySelector(
      'input[name="title"]',
    ) as HTMLInputElement
    expect(titleInput).not.toBeNull()
    expect(titleInput.value).toBe('')
    // kind hidden input falls back to EventForm's default.
    const kindInput = container.querySelector(
      'input[name="kind"]',
    ) as HTMLInputElement
    expect(kindInput.value).toBe('individual')
  })
})
