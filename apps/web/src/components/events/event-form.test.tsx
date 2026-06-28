import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventForm } from './event-form'

const NEW_FIELD_NAMES = [
  'feeJpy',
  'paymentDeadline',
  'paymentInfo',
  'paymentMethod',
  'entryMethod',
  'organizer',
  'capacityA',
  'capacityB',
  'capacityC',
  'capacityD',
  'capacityE',
] as const

const noop = () => {}

describe('EventForm', () => {
  it("mode='create' で「作成」ボタンが表示される", () => {
    render(
      <EventForm
        mode="create"
        action={noop}        cancelHref="/events"
      />,
    )
    expect(screen.getByRole('button', { name: '作成' })).toBeTruthy()
  })

  it("mode='edit' で「更新」ボタンが表示され、defaultValues の title が input に入っている", () => {
    render(
      <EventForm
        mode="edit"
        action={noop}        cancelHref="/events/1"
        defaultValues={{ title: '春の大会' }}
      />,
    )
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy()
    const titleInput = screen.getByDisplayValue('春の大会') as HTMLInputElement
    expect(titleInput.name).toBe('title')
  })

  it("mode='create' で新規追加された 11 フィールドが全てレンダリングされる", () => {
    const { container } = render(
      <EventForm
        mode="create"
        action={noop}        cancelHref="/events"
      />,
    )
    for (const name of NEW_FIELD_NAMES) {
      const el = container.querySelector(`[name="${name}"]`)
      expect(el, `field ${name} should be rendered`).toBeTruthy()
    }
  })

  it("mode='edit' で feeJpy / capacityA / paymentInfo の defaultValues が反映される", () => {
    const { container } = render(
      <EventForm
        mode="edit"
        action={noop}        cancelHref="/events/1"
        defaultValues={{
          feeJpy: 5000,
          capacityA: 32,
          paymentInfo: '○○銀行 普通 1234567',
        }}
      />,
    )
    const fee = container.querySelector(
      '[name="feeJpy"]',
    ) as HTMLInputElement | null
    const capA = container.querySelector(
      '[name="capacityA"]',
    ) as HTMLInputElement | null
    const info = container.querySelector(
      '[name="paymentInfo"]',
    ) as HTMLTextAreaElement | null
    expect(fee?.value).toBe('5000')
    expect(capA?.value).toBe('32')
    expect(info?.value).toBe('○○銀行 普通 1234567')
  })

  // entry-notify-lottery-treasurer ------------------------------------------
  it("mode='create' で抽選日 (lotteryDate) の date 入力が描画される（空デフォルト）", () => {
    const { container } = render(
      <EventForm mode="create" action={noop} cancelHref="/events" />,
    )
    const lottery = container.querySelector(
      '[name="lotteryDate"]',
    ) as HTMLInputElement | null
    expect(lottery).toBeTruthy()
    expect(lottery?.type).toBe('date')
    expect(lottery?.value).toBe('')
  })

  it("mode='edit' で lotteryDate の defaultValues が反映される", () => {
    const { container } = render(
      <EventForm
        mode="edit"
        action={noop}        cancelHref="/events/1"
        defaultValues={{ lotteryDate: '2026-01-20' }}
      />,
    )
    const lottery = container.querySelector(
      '[name="lotteryDate"]',
    ) as HTMLInputElement | null
    expect(lottery?.value).toBe('2026-01-20')
  })

  it('embedded（承認画面）モードでは lotteryDate 入力欄は描画しない（要件 §5.2）', () => {
    const { container } = render(
      <EventForm
        mode="create"
        action={noop}        cancelHref="/events"
        fieldPrefix="u1__"
      />,
    )
    // namespaced も bare もどちらも無いことを確認
    expect(container.querySelector('[name="u1__lotteryDate"]')).toBeNull()
    expect(container.querySelector('[name="lotteryDate"]')).toBeNull()
    // 締切群は描画されていること（embedded でも申込締切は出る）
    expect(container.querySelector('[name="u1__entryDeadline"]')).toBeTruthy()
  })
})
