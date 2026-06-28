import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {
  EventUnit,
  ExtractionPayload,
} from '@kagetra/mail-worker/classify/schema'
import { ApprovalForm } from './ApprovalForm'

const noop = () => {}

/**
 * Build a fully-populated EventUnit. Defaults are picked so displayed values
 * are easy to spot in assertions (unique title-able grades, distinct numbers).
 */
function buildUnit(overrides: Partial<EventUnit> = {}): EventUnit {
  return {
    unit_key: 'u1',
    event_date: '2030-12-01',
    eligible_grades: ['A', 'B'],
    formal_name: '第10回テスト大会A・B級',
    venue: 'AI 会場',
    fee_jpy: 4500,
    payment_deadline: '2030-11-25',
    payment_info_text: '○○銀行 普通 1234567',
    payment_method: '事前振込',
    entry_method: 'メール申込',
    organizer_text: '主催 X',
    entry_deadline: '2030-11-30',
    kind: 'team',
    capacity_a: 32,
    capacity_b: 16,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
    ...overrides,
  }
}

function buildPayload(
  events: EventUnit[],
  shortNameStem: string | null = '大阪',
): ExtractionPayload {
  return {
    is_tournament_announcement: true,
    confidence: 0.9,
    reason: 'fixture',
    is_correction: false,
    references_subject: null,
    short_name_stem: shortNameStem,
    events,
  }
}

describe('ApprovalForm — 複数単位フォーム', () => {
  it('単一単位: stem+級から title を合成し各フィールドにマッピングする', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    // title = composeTitle('大阪', ['A','B']) = '大阪AB'
    const titleInput = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    expect(titleInput.value).toBe('大阪AB')

    const dateInput = container.querySelector(
      'input[name="u1__eventDate"]',
    ) as HTMLInputElement
    expect(dateInput.value).toBe('2030-12-01')

    const locationInput = container.querySelector(
      'input[name="u1__location"]',
    ) as HTMLInputElement
    expect(locationInput.value).toBe('AI 会場')

    const feeInput = container.querySelector(
      'input[name="u1__feeJpy"]',
    ) as HTMLInputElement
    expect(feeInput.value).toBe('4500')

    const capAInput = container.querySelector(
      'input[name="u1__capacityA"]',
    ) as HTMLInputElement
    expect(capAInput.value).toBe('32')

    const formalNameInput = container.querySelector(
      'input[name="u1__formalName"]',
    ) as HTMLInputElement
    expect(formalNameInput.value).toBe('第10回テスト大会A・B級')

    // register checkbox is present and checked by default
    const register = container.querySelector(
      'input[name="u1__register"]',
    ) as HTMLInputElement
    expect(register).not.toBeNull()
    expect(register.checked).toBe(true)

    // hidden unit_key marker
    const unitKey = container.querySelector(
      'input[name="unit_key"]',
    ) as HTMLInputElement
    expect(unitKey.value).toBe('u1')
  })

  it('開催(edition)紐付けセクション: 候補を pre-fill し回次ありなら link を ON にする', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: 'こばえちゃ山形酒田大会', editionNumber: 28, matched: true }}
        action={noop}
      />,
    )
    const link = container.querySelector(
      'input[name="editionLink"]',
    ) as HTMLInputElement
    expect(link.checked).toBe(true)
    const seriesName = container.querySelector(
      'input[name="editionSeriesName"]',
    ) as HTMLInputElement
    expect(seriesName.value).toBe('こばえちゃ山形酒田大会')
    const editionNumber = container.querySelector(
      'input[name="editionNumber"]',
    ) as HTMLInputElement
    expect(editionNumber.value).toBe('28')
    // 新規系列作成は明示チェック（既定 OFF・Codex R3）
    const createNew = container.querySelector(
      'input[name="editionCreateNewSeries"]',
    ) as HTMLInputElement
    expect(createNew).not.toBeNull()
    expect(createNew.checked).toBe(false)
  })

  it('開催(edition)紐付けセクション: 既存系列に未一致なら（回次があっても）link は OFF', () => {
    // Codex R1 should_fix: 新規系列候補は管理者が明示チェックする運用。
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '新規っぽい大会', editionNumber: 5, matched: false }}
        action={noop}
      />,
    )
    const link = container.querySelector(
      'input[name="editionLink"]',
    ) as HTMLInputElement
    expect(link.checked).toBe(false)
    // 系列名・回次は pre-fill される（チェックを入れれば使える）
    expect(
      (container.querySelector('input[name="editionSeriesName"]') as HTMLInputElement).value,
    ).toBe('新規っぽい大会')
  })

  it('開催日分割: 2 単位を別フォームとして描画し title を級ごとに合成する', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', eligible_grades: ['B'], event_date: '2031-01-11' }),
      buildUnit({ unit_key: 'u2', eligible_grades: ['C'], event_date: '2031-01-12' }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const title1 = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    expect(title1.value).toBe('大阪B')
    const date1 = container.querySelector(
      'input[name="u1__eventDate"]',
    ) as HTMLInputElement
    expect(date1.value).toBe('2031-01-11')

    const title2 = container.querySelector(
      'input[name="u2__title"]',
    ) as HTMLInputElement
    expect(title2.value).toBe('大阪C')
    const date2 = container.querySelector(
      'input[name="u2__eventDate"]',
    ) as HTMLInputElement
    expect(date2.value).toBe('2031-01-12')

    // both register checkboxes default ON
    const reg1 = container.querySelector(
      'input[name="u1__register"]',
    ) as HTMLInputElement
    const reg2 = container.querySelector(
      'input[name="u2__register"]',
    ) as HTMLInputElement
    expect(reg1.checked).toBe(true)
    expect(reg2.checked).toBe(true)

    // two unit_key hidden inputs
    const unitKeys = Array.from(
      container.querySelectorAll('input[name="unit_key"]'),
    ) as HTMLInputElement[]
    expect(unitKeys.map((i) => i.value).sort()).toEqual(['u1', 'u2'])

    // heading reflects N=2
    expect(
      screen.getByText('この案内から 2 件のイベントを作成します'),
    ).toBeDefined()
  })

  it('登録済み単位はフォームを出さず読み取り表示（events #N）になる', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', eligible_grades: ['B'] }),
      buildUnit({ unit_key: 'u2', eligible_grades: ['C'] }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[{ unitKey: 'u1', eventId: 42 }]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    // u1 is registered → no editable title input, shows events #42
    expect(
      container.querySelector('input[name="u1__title"]'),
    ).toBeNull()
    expect(screen.getByText(/events #42/)).toBeDefined()
    // heading shows registered count
    expect(
      screen.getByText('この案内から 2 件のイベントを作成します（うち登録済み 1 件）'),
    ).toBeDefined()

    // u2 still editable
    expect(
      container.querySelector('input[name="u2__title"]'),
    ).not.toBeNull()
  })

  it('級が null の単位は title を stem のみにする', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', eligible_grades: null }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="酒田"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const title = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    expect(title.value).toBe('酒田')
  })

  it('旧形式 payload (extracted のみ) を 1 単位に正規化して描画する', () => {
    // Legacy ExtractionPayload shape from before the 2.0.0 bump.
    const legacyPayload = {
      is_tournament_announcement: true,
      confidence: 0.7,
      reason: 'legacy',
      extracted: {
        title: '第65回全日本かるた選手権大会',
        formal_name: '第65回全日本かるた選手権大会',
        event_date: '2030-05-10',
        venue: '近江神宮',
        fee_jpy: 3000,
        payment_deadline: null,
        payment_info_text: null,
        payment_method: null,
        entry_method: null,
        organizer_text: null,
        entry_deadline: null,
        eligible_grades: ['A'],
        kind: 'individual',
        capacity_total: 100,
        capacity_a: 100,
        capacity_b: null,
        capacity_c: null,
        capacity_d: null,
        capacity_e: null,
        official: true,
      },
    } as unknown as ExtractionPayload

    const { container } = render(
      <ApprovalForm
        payload={legacyPayload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    // No stem → title falls back to the legacy full title.
    const title = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    expect(title.value).toBe('第65回全日本かるた選手権大会')
    const venue = container.querySelector(
      'input[name="u1__location"]',
    ) as HTMLInputElement
    expect(venue.value).toBe('近江神宮')
    const capA = container.querySelector(
      'input[name="u1__capacityA"]',
    ) as HTMLInputElement
    expect(capA.value).toBe('100')

    // single synthetic unit
    expect(
      screen.getByText('この案内から 1 件のイベントを作成します'),
    ).toBeDefined()
  })

  it('payload=null (ai_failed) でも 1 つの空フォームを描画する', () => {
    const { container } = render(
      <ApprovalForm
        payload={null}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const title = container.querySelector(
      'input[name="u1__title"]',
    ) as HTMLInputElement
    expect(title).not.toBeNull()
    expect(title.value).toBe('')
    // kind hidden falls back to EventForm default
    const kind = container.querySelector(
      'input[name="u1__kind"]',
    ) as HTMLInputElement
    expect(kind.value).toBe('individual')
  })

  it('AI が kind=null を返した単位は EventForm デフォルト individual に倒す', () => {
    const payload = buildPayload([buildUnit({ kind: null })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const kind = container.querySelector(
      'input[name="u1__kind"]',
    ) as HTMLInputElement
    expect(kind.value).toBe('individual')
  })

  it('会内締切を大会申込締切の 6 日前で prefill する', () => {
    // buildUnit デフォルトの entry_deadline = 2030-11-30 → 6 日前 = 2030-11-24
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const entryDeadline = container.querySelector(
      'input[name="u1__entryDeadline"]',
    ) as HTMLInputElement
    expect(entryDeadline.value).toBe('2030-11-30')
    const internalDeadline = container.querySelector(
      'input[name="u1__internalDeadline"]',
    ) as HTMLInputElement
    expect(internalDeadline.value).toBe('2030-11-24')
  })

  it('会内締切の 6 日前計算は月・年跨ぎでも正しい', () => {
    const payload = buildPayload([
      buildUnit({ entry_deadline: '2031-01-03' }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const internalDeadline = container.querySelector(
      'input[name="u1__internalDeadline"]',
    ) as HTMLInputElement
    expect(internalDeadline.value).toBe('2030-12-28')
  })

  it('entry_deadline が null の単位は会内締切を prefill しない', () => {
    const payload = buildPayload([buildUnit({ entry_deadline: null })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
    const internalDeadline = container.querySelector(
      'input[name="u1__internalDeadline"]',
    ) as HTMLInputElement
    expect(internalDeadline.value).toBe('')
  })
})
