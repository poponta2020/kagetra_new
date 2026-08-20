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
        action={noop}
        cancelHref="/events"
      />,
    )
    expect(screen.getByRole('button', { name: '作成' })).toBeTruthy()
  })

  it("mode='edit' で「更新」ボタンが表示され、defaultValues の title が input に入っている", () => {
    render(
      <EventForm
        mode="edit"
        action={noop}
        cancelHref="/events/1"
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
        action={noop}
        cancelHref="/events"
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
        action={noop}
        cancelHref="/events/1"
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
        action={noop}
        cancelHref="/events/1"
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
        action={noop}
        cancelHref="/events"
        fieldPrefix="u1__"
      />,
    )
    // namespaced も bare もどちらも無いことを確認
    expect(container.querySelector('[name="u1__lotteryDate"]')).toBeNull()
    expect(container.querySelector('[name="lotteryDate"]')).toBeNull()
    // 締切群は描画されていること（embedded でも申込締切は出る）
    expect(container.querySelector('[name="u1__entryDeadline"]')).toBeTruthy()
    // 開催(edition) 紐付け欄も embedded では出さない（ApprovalForm が別途持つ）
    expect(container.querySelector('[name="editionLink"]')).toBeNull()
    expect(container.querySelector('[name="u1__editionLink"]')).toBeNull()
  })

  // tournament-entry-rosters (Codex R6): 手動作成/編集の edition 紐付け欄
  it("mode='create'（非 embedded）で edition 紐付け欄が描画される（既定 OFF・空）", () => {
    const { container } = render(
      <EventForm mode="create" action={noop} cancelHref="/events" />,
    )
    const link = container.querySelector('[name="editionLink"]') as HTMLInputElement | null
    expect(link).toBeTruthy()
    expect(link?.checked).toBe(false)
    expect(container.querySelector('[name="editionSeriesName"]')).toBeTruthy()
    expect(container.querySelector('[name="editionNumber"]')).toBeTruthy()
    expect(container.querySelector('[name="editionCreateNewSeries"]')).toBeTruthy()
  })

  it("mode='edit' で editionDefault を pre-fill し link を ON にする", () => {
    const { container } = render(
      <EventForm
        mode="edit"
        action={noop}
        cancelHref="/events/1"
        editionDefault={{ seriesName: 'こばえちゃ山形酒田大会', editionNumber: 28, linked: true }}
      />,
    )
    const link = container.querySelector('[name="editionLink"]') as HTMLInputElement
    expect(link.checked).toBe(true)
    expect(
      (container.querySelector('[name="editionSeriesName"]') as HTMLInputElement).value,
    ).toBe('こばえちゃ山形酒田大会')
    expect(
      (container.querySelector('[name="editionNumber"]') as HTMLInputElement).value,
    ).toBe('28')
  })

  // draft 廃止: status コントロールの出し分け ---------------------------------
  it("mode='create' では status コントロールを描画しない（常に published で作成）", () => {
    const { container } = render(
      <EventForm mode="create" action={noop} cancelHref="/events" />,
    )
    expect(container.querySelector('[name="status"]')).toBeNull()
  })

  it("embedded（承認画面・mode='create'）でも status コントロールを描画しない", () => {
    const { container } = render(
      <EventForm
        mode="create"
        action={noop}
        cancelHref="/events"
        fieldPrefix="u1__"
      />,
    )
    expect(container.querySelector('[name="u1__status"]')).toBeNull()
    expect(container.querySelector('[name="status"]')).toBeNull()
  })

  it("mode='edit' では status コントロールが 公開(通常)/中止/終了 の 3 値で描画される（既定 published）", () => {
    const { container } = render(
      <EventForm mode="edit" action={noop} cancelHref="/events/1" />,
    )
    const select = container.querySelector('[name="status"]') as HTMLSelectElement | null
    expect(select).toBeTruthy()
    const optionValues = Array.from(select!.options).map((o) => o.value)
    expect(optionValues).toEqual(['published', 'cancelled', 'done'])
    // draft option が消えていること
    expect(optionValues).not.toContain('draft')
    // 既定は published（defaultValue 未指定時）
    expect(select!.value).toBe('published')
  })

  it("mode='edit' で defaultValues.status=cancelled が select に反映される（中止からの復帰導線）", () => {
    const { container } = render(
      <EventForm
        mode="edit"
        action={noop}
        cancelHref="/events/1"
        defaultValues={{ status: 'cancelled' }}
      />,
    )
    const select = container.querySelector('[name="status"]') as HTMLSelectElement
    expect(select.value).toBe('cancelled')
    // 「公開（通常）」の option があるので通常状態に戻せる
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toContain('published')
  })

  // entry-groups タスク2: 申込グループ欄 / 伝播 submit ボタンの差し込み --------
  it("mode='edit'（非 embedded）で entryGroupSection が描画される", () => {
    render(
      <EventForm
        mode="edit"
        action={noop}
        cancelHref="/events/1"
        entryGroupSection={<div data-testid="entry-group-section">group ui</div>}
      />,
    )
    expect(screen.getByTestId('entry-group-section')).toBeTruthy()
  })

  it('embedded（承認画面）モードでは entryGroupSection を渡しても描画しない', () => {
    render(
      <EventForm
        mode="create"
        action={noop}
        cancelHref="/events"
        fieldPrefix="u1__"
        entryGroupSection={<div data-testid="entry-group-section">group ui</div>}
      />,
    )
    expect(screen.queryByTestId('entry-group-section')).toBeNull()
  })

  it('submitButton を渡すと既定の「更新」ボタンの代わりに描画される', () => {
    render(
      <EventForm
        mode="edit"
        action={noop}
        cancelHref="/events/1"
        submitButton={<button type="submit">カスタム保存</button>}
      />,
    )
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
    expect(screen.getByRole('button', { name: 'カスタム保存' })).toBeTruthy()
  })

  it('submitButton を渡さない場合は既定の「更新」ボタンが描画される（回帰）', () => {
    render(<EventForm mode="edit" action={noop} cancelHref="/events/1" />)
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy()
  })

  // mail-ai-extract-refinements タスク12 (§3.2.7 / AC-42〜44): 振込締切の状態
  // （paymentDeadlineKind）を選ぶ <select>。
  describe('paymentDeadlineKind（振込締切の状態）', () => {
    it("mode='create' で3値（日付あり/後日連絡/締切未設定）の select が描画され、既定は「締切未設定」", () => {
      const { container } = render(
        <EventForm mode="create" action={noop} cancelHref="/events" />,
      )
      const select = container.querySelector(
        '[name="paymentDeadlineKind"]',
      ) as HTMLSelectElement | null
      expect(select).toBeTruthy()
      const optionValues = Array.from(select!.options).map((o) => o.value)
      expect(optionValues).toEqual(['fixed', 'later_notice', 'unspecified'])
      const optionLabels = Array.from(select!.options).map((o) => o.textContent)
      expect(optionLabels).toEqual(['日付あり', '後日連絡', '締切未設定'])
      expect(select!.value).toBe('unspecified')
    })

    it("mode='edit' で defaultValues.paymentDeadlineKind が select に反映される", () => {
      const { container } = render(
        <EventForm
          mode="edit"
          action={noop}
          cancelHref="/events/1"
          defaultValues={{ paymentDeadlineKind: 'later_notice' }}
        />,
      )
      const select = container.querySelector(
        '[name="paymentDeadlineKind"]',
      ) as HTMLSelectElement
      expect(select.value).toBe('later_notice')
    })

    it('embedded（承認画面）モードでは paymentDeadlineKind の select を描画しない', () => {
      const { container } = render(
        <EventForm
          mode="create"
          action={noop}
          cancelHref="/events"
          fieldPrefix="u1__"
        />,
      )
      expect(container.querySelector('[name="u1__paymentDeadlineKind"]')).toBeNull()
      expect(container.querySelector('[name="paymentDeadlineKind"]')).toBeNull()
    })
  })

  // entry-group-page タスク4 (AC-21): 日ページの編集フォームからグループ共通7項目を撤去。
  describe('hideGroupCommonFields', () => {
    it('未指定（既定）では7項目が全部出る（events/new・承認フォームの回帰）', () => {
      const { container } = render(
        <EventForm mode="create" action={noop} cancelHref="/events" />,
      )
      for (const name of [
        'entryDeadline',
        'internalDeadline',
        'lotteryDate',
        'paymentDeadline',
        'paymentDeadlineKind',
        'paymentMethod',
        'paymentInfo',
        'entryMethod',
      ]) {
        expect(
          container.querySelector(`[name="${name}"]`),
          `field ${name} should be rendered by default`,
        ).toBeTruthy()
      }
    })

    it('true を渡すと7項目が消え、参加費・タイトル・級別定員などの日固有項目は残る', () => {
      const { container } = render(
        <EventForm
          mode="edit"
          action={noop}
          cancelHref="/events/1"
          hideGroupCommonFields
          defaultValues={{ title: '杉並A', feeJpy: 2500, capacityA: 128 }}
        />,
      )
      for (const name of [
        'entryDeadline',
        'internalDeadline',
        'lotteryDate',
        'paymentDeadline',
        'paymentDeadlineKind',
        'paymentMethod',
        'paymentInfo',
        'entryMethod',
      ]) {
        expect(
          container.querySelector(`[name="${name}"]`),
          `field ${name} should NOT be rendered when hideGroupCommonFields`,
        ).toBeNull()
      }
      // 日固有項目は残る。
      expect(container.querySelector('[name="title"]')).toBeTruthy()
      expect(container.querySelector('[name="feeJpy"]')).toBeTruthy()
      expect(container.querySelector('[name="capacityA"]')).toBeTruthy()
      const fee = container.querySelector('[name="feeJpy"]') as HTMLInputElement
      expect(fee.value).toBe('2500')
    })
  })
})
