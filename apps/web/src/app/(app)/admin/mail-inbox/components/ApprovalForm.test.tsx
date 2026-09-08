import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  EventUnit,
  ExtractionPayload,
  RegionalEligibility,
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
    payment_deadline: '2030-11-25',
    payment_deadline_kind: '日付あり',
    payment_info_text: '○○銀行 普通 1234567',
    payment_method: '口座振込',
    entry_method: 'メール',
    organizer_text: '主催 X',
    entry_deadline: '2030-11-30',
    kind: 'team',
    capacity_total: null,
    capacity_a: 32,
    capacity_b: 16,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
    regional_eligibility: [],
    ...overrides,
  }
}

function buildPayload(events: EventUnit[]): ExtractionPayload {
  return {
    reason: 'fixture',
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

    // 参加費は AI が埋めなくなった（級から決定的に導出できるため 3.0.0 で削除）。
    // 手入力できる状態は維持する。
    const feeInput = container.querySelector(
      'input[name="u1__feeJpy"]',
    ) as HTMLInputElement
    expect(feeInput.value).toBe('')

    // AC-39: payload の「日付あり」が events の英語 enum へ hidden で運ばれる。
    const kindInput = container.querySelector(
      'input[name="u1__paymentDeadlineKind"]',
    ) as HTMLInputElement
    expect(kindInput.value).toBe('fixed')

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
        editionSuggestion={{
          seriesId: 7,
          seriesName: 'こばえちゃ山形酒田大会',
          editionNumber: 28,
          matched: true,
        }}
        seriesOptions={[
          { id: 7, name: 'こばえちゃ山形酒田大会', aliases: ['山形・酒田大会'], kind: 'team' },
        ]}
        action={noop}
      />,
    )
    const link = container.querySelector(
      'input[name="editionLink"]',
    ) as HTMLInputElement
    expect(link.checked).toBe(true)
    const seriesId = container.querySelector(
      'input[name="editionSeriesId"]',
    ) as HTMLInputElement
    expect(seriesId.value).toBe('7')
    expect(screen.getByText('選択済み')).toBeDefined()
    expect(screen.getByText('こばえちゃ山形酒田大会')).toBeDefined()
    const editionNumber = container.querySelector(
      'input[name="editionNumber"]',
    ) as HTMLInputElement
    expect(editionNumber.value).toBe('28')
    expect(container.querySelector('input[name="editionCreateNewSeries"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '解除' }))
    expect(seriesId.value).toBe('')
    expect(link.checked).toBe(false)
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
    expect(screen.getByText('系列は未選択です')).toBeDefined()
    expect(screen.getByText('AI候補: 新規っぽい大会')).toBeDefined()
    expect((container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement).value).toBe('')
  })

  it('正準名・別名で検索し、候補選択を系列 ID として送る', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesId: null, seriesName: 'シニア', editionNumber: 12, matched: false }}
        seriesOptions={[
          { id: 11, name: 'シニア選手権', aliases: ['シニア選手権大会'], kind: 'team' },
          { id: 12, name: '全国団体戦', aliases: [], kind: 'team' },
          { id: 13, name: '個人戦大会', aliases: [], kind: 'individual' },
        ]}
        action={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
    expect(within(dialog).getByText('シニア選手権')).toBeDefined()
    expect(within(dialog).getByText('一致した別名: シニア選手権大会')).toBeDefined()
    expect(within(dialog).queryByText('個人戦大会')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: /シニア選手権/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))
    expect((container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement).value).toBe('11')
    expect((container.querySelector('input[name="editionLink"]') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const reopened = screen.getByRole('dialog', { name: '大会系列を検索' })
    expect((within(reopened).getByRole('radio', { name: /シニア選手権/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(reopened).getByRole('button', { name: 'キャンセル' }))
  })

  it('0件時だけ検索語を新しい系列として明示できる', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesId: null, seriesName: '新設大会', editionNumber: 1, matched: false }}
        seriesOptions={[]}
        action={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /「新設大会」を新しい系列として作成する/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))
    expect((container.querySelector('input[name="editionSeriesName"]') as HTMLInputElement).value).toBe('新設大会')
    expect((container.querySelector('input[name="editionCreateNewSeries"]') as HTMLInputElement).value).toBe('on')
  })

  it('登録対象の個人戦・団体戦が混在中は系列選択を無効にする', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', event_date: '2030-12-01', kind: 'team' }),
      buildUnit({ unit_key: 'u2', event_date: '2030-12-02', kind: 'individual' }),
    ])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: 1, matched: false }}
        seriesOptions={[]}
        action={noop}
      />,
    )
    const search = screen.getByRole('button', { name: '系列を検索・選択' })
    expect((search as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/個人戦と団体戦が混在/)).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: 'このイベントを登録する (2030-12-01)' }))
    expect((search as HTMLButtonElement).disabled).toBe(false)
  })

  it('初期候補の系列種別が登録対象と異なる場合は選択しない', () => {
    // mail-ai-extract-refinements タスク2: shortNameStem を空にして、通称欄が
    // 系列由来の kind ゲートの実装スリップを拾えるようにする（seriesShortName を
    // 非空にしておき、ゲートが漏れて採用されていたら通称欄が非空になってしまう）。
    const payload = buildPayload([buildUnit({ kind: 'team' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesId: 13,
          seriesName: '個人戦大会',
          seriesShortName: '個人戦',
          editionNumber: 4,
          matched: true,
        }}
        seriesOptions={[
          { id: 13, name: '個人戦大会', aliases: [], kind: 'individual' },
        ]}
        action={noop}
      />,
    )

    expect(
      (container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement)
        .value,
    ).toBe('')
    expect(
      (container.querySelector('input[name="editionLink"]') as HTMLInputElement)
        .checked,
    ).toBe(false)
    expect(
      (screen.getByLabelText('通称') as HTMLInputElement).value,
    ).toBe('')
  })

  it('登録対象の種別変更で選択済み系列が不適合になったら解除する', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', event_date: '2030-12-01', kind: 'team' }),
      buildUnit({ unit_key: 'u2', event_date: '2030-12-02', kind: 'individual' }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: 1, matched: false }}
        seriesOptions={[
          { id: 7, name: '団体戦大会', aliases: [], kind: 'team' },
        ]}
        action={noop}
      />,
    )

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'このイベントを登録する (2030-12-02)',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '団体戦大会' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

    const seriesId = container.querySelector(
      'input[name="editionSeriesId"]',
    ) as HTMLInputElement
    const editionLink = container.querySelector(
      'input[name="editionLink"]',
    ) as HTMLInputElement
    expect(seriesId.value).toBe('7')
    expect(editionLink.checked).toBe(true)

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'このイベントを登録する (2030-12-02)',
      }),
    )
    expect(seriesId.value).toBe('')
    expect(editionLink.checked).toBe(false)
  })

  it('別種別に同名系列がある場合は新規系列作成を提示しない', () => {
    const payload = buildPayload([buildUnit({ kind: 'team' })])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesName: '同名大会',
          editionNumber: 1,
          matched: false,
        }}
        seriesOptions={[
          { id: 8, name: '同名大会', aliases: [], kind: 'individual' },
        ]}
        action={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
    expect(
      within(dialog).getByText(
        '同じ名前の系列が別の大会種別で登録されています。大会種別を確認してください。',
      ),
    ).toBeDefined()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  it('新規系列の確認後に登録対象の種別が変わったら確認を解除する', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', event_date: '2030-12-01', kind: 'team' }),
      buildUnit({ unit_key: 'u2', event_date: '2030-12-02', kind: 'individual' }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesName: '新規大会',
          editionNumber: 1,
          matched: false,
        }}
        seriesOptions={[]}
        action={noop}
      />,
    )

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'このイベントを登録する (2030-12-02)',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
    const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

    expect(
      (container.querySelector(
        'input[name="editionCreateNewSeries"]',
      ) as HTMLInputElement).value,
    ).toBe('on')
    expect(
      (container.querySelector('input[name="editionLink"]') as HTMLInputElement)
        .checked,
    ).toBe(true)

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'このイベントを登録する (2030-12-02)',
      }),
    )
    expect(
      container.querySelector('input[name="editionCreateNewSeries"]'),
    ).toBeNull()
    expect(
      (container.querySelector('input[name="editionLink"]') as HTMLInputElement)
        .checked,
    ).toBe(false)
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

  // event-grade-group-broadcast タスク6: 承認フォームの要綱選択 ────────────
  it('要綱選択: 候補があるとき「選択しない」がデフォルトで選ばれている', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        attachmentCandidates={[
          { id: 1, filename: '要綱.pdf', contentType: 'application/pdf', extractionStatus: 'extracted' },
          { id: 2, filename: '組合せ表.pdf', contentType: 'application/pdf', extractionStatus: 'pending' },
        ]}
        action={noop}
      />,
    )

    const radios = Array.from(
      container.querySelectorAll('input[name="gradeBroadcastAttachmentId"]'),
    ) as HTMLInputElement[]
    expect(radios).toHaveLength(3) // 「選択しない」+ 候補2件
    const none = radios.find((r) => r.value === '')
    expect(none?.checked).toBe(true)
    expect(radios.filter((r) => r.checked)).toHaveLength(1)
    expect(screen.getByText('要綱.pdf')).toBeDefined()
    expect(screen.getByText('組合せ表.pdf')).toBeDefined()
  })

  it('要綱選択: 候補が0件（元メールに添付が無い）なら空状態を表示する', () => {
    const payload = buildPayload([buildUnit()])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="大阪"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        attachmentCandidates={[]}
        action={noop}
      />,
    )

    expect(
      container.querySelector('input[name="gradeBroadcastAttachmentId"]'),
    ).toBeNull()
    expect(screen.getByText('添付がありません')).toBeDefined()
  })

  // entry-groups タスク7: 承認フォームの自動グループ提案 (AC-20) ──────────
  describe('申込グループの自動提案', () => {
    it('ユニットが2件以上: 同じ申込締切のユニットは同じグループ提案、異なる締切は別グループになる', () => {
      const payload = buildPayload([
        buildUnit({
          unit_key: 'u1',
          eligible_grades: ['A'],
          event_date: '2031-01-11',
          entry_deadline: '2031-01-01',
        }),
        buildUnit({
          unit_key: 'u2',
          eligible_grades: ['B'],
          event_date: '2031-01-11',
          entry_deadline: '2031-01-01',
        }),
        buildUnit({
          unit_key: 'u3',
          eligible_grades: ['C'],
          event_date: '2031-01-20',
          entry_deadline: '2031-01-15',
        }),
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

      const select = (unitKey: string) =>
        container.querySelector(
          `select[name="${unitKey}__group_key"]`,
        ) as HTMLSelectElement

      expect(screen.getByText('申込グループ')).toBeDefined()
      expect(select('u1').value).toBe(select('u2').value)
      expect(select('u3').value).not.toBe(select('u1').value)
    })

    it('ユニットが1件のみ: グループ提案 UI を出さない（エラーケース＝シングルトン自動生成のまま）', () => {
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

      expect(container.querySelector('select[name="u1__group_key"]')).toBeNull()
      expect(screen.queryByText('申込グループ')).toBeNull()
    })

    it('割当を「新規グループ」に変更すると group_key の値が変わる（別グループへ移動できる）', () => {
      const payload = buildPayload([
        buildUnit({ unit_key: 'u1', event_date: '2031-01-11', entry_deadline: '2031-01-01' }),
        buildUnit({ unit_key: 'u2', event_date: '2031-01-11', entry_deadline: '2031-01-01' }),
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

      const u1Select = container.querySelector(
        'select[name="u1__group_key"]',
      ) as HTMLSelectElement
      const u2Select = container.querySelector(
        'select[name="u2__group_key"]',
      ) as HTMLSelectElement
      // 同じ申込締切 → 自動提案は同じグループ。
      expect(u1Select.value).toBe(u2Select.value)

      fireEvent.change(u2Select, { target: { value: '__new__' } })
      expect(u2Select.value).not.toBe(u1Select.value)
    })

    it('登録済み単位はグループ提案の対象に含めない', () => {
      const payload = buildPayload([
        buildUnit({ unit_key: 'u1', event_date: '2031-01-11' }),
        buildUnit({ unit_key: 'u2', event_date: '2031-01-11' }),
        buildUnit({ unit_key: 'u3', event_date: '2031-01-11' }),
      ])
      const { container } = render(
        <ApprovalForm
          payload={payload}
          shortNameStem="大阪"
          registeredUnitKeys={[{ unitKey: 'u1', eventId: 1 }]}
          editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
          action={noop}
        />,
      )

      // u1 は登録済みなのでグループ提案の対象外。u2/u3 だけが編集対象として残る。
      expect(container.querySelector('select[name="u1__group_key"]')).toBeNull()
      expect(
        container.querySelector('select[name="u2__group_key"]'),
      ).not.toBeNull()
      expect(
        container.querySelector('select[name="u3__group_key"]'),
      ).not.toBeNull()
    })
  })
})

/**
 * mail-ai-extract-refinements §3.2.3: 通称は AI ではなく人が入力する。
 * `composeTitle` 自体は不変で、stem の供給元だけが変わった。
 */
describe('ApprovalForm — 通称欄（AC-15 / AC-16 / AC-17）', () => {
  function renderWithTwoUnits() {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', eligible_grades: ['B'], event_date: '2030-12-01' }),
      buildUnit({ unit_key: 'u2', eligible_grades: ['C'], event_date: '2030-12-02' }),
    ])
    return render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )
  }

  it('AC-17: 通称が未入力のあいだ合成結果は空（級だけの値を出さない）', () => {
    const { container } = renderWithTwoUnits()
    const t1 = container.querySelector('input[name="u1__title"]') as HTMLInputElement
    const t2 = container.querySelector('input[name="u2__title"]') as HTMLInputElement
    expect(t1.value).toBe('')
    expect(t2.value).toBe('')
  })

  it('AC-15: 通称を入れると各単位の大会名が合成される', () => {
    const { container } = renderWithTwoUnits()
    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '大阪' } })
    const t1 = container.querySelector('input[name="u1__title"]') as HTMLInputElement
    const t2 = container.querySelector('input[name="u2__title"]') as HTMLInputElement
    expect(t1.value).toBe('大阪B')
    expect(t2.value).toBe('大阪C')
  })

  it('AC-16: 単位ごとに個別上書きでき、上書きした単位は通称の変更に追随しない', () => {
    const { container } = renderWithTwoUnits()
    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '大阪' } })
    const t1 = container.querySelector('input[name="u1__title"]') as HTMLInputElement
    const t2 = container.querySelector('input[name="u2__title"]') as HTMLInputElement

    fireEvent.change(t2, { target: { value: '大阪C（会場変更）' } })
    expect(t2.value).toBe('大阪C（会場変更）')

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '堺' } })
    expect(t1.value).toBe('堺B')
    expect(t2.value).toBe('大阪C（会場変更）')
  })

  it('通称の前後空白だけの入力は未入力として扱う', () => {
    const { container } = renderWithTwoUnits()
    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '   ' } })
    const t1 = container.querySelector('input[name="u1__title"]') as HTMLInputElement
    expect(t1.value).toBe('')
  })
})

/**
 * mail-ai-extract-refinements タスク2: 通称⇄系列連動（AC-45〜53）。
 * 通称欄と系列選択を双方向に連動させ、同じ語を二度打つ状態を解消する。
 */
describe('ApprovalForm — 通称⇄系列連動（AC-45〜53）', () => {
  it('AC-45: 名寄せ候補が1件のとき、系列が選択済みになり通称欄に short_name が入り、由来が表示される', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesId: 21,
          seriesName: '全国競技かるた杉並大会',
          seriesShortName: '杉並',
          editionNumber: 3,
          matched: false,
        }}
        seriesOptions={[
          { id: 21, name: '全国競技かるた杉並大会', aliases: [], kind: 'individual' },
        ]}
        action={noop}
      />,
    )

    expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe('杉並')
    expect(
      (container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement)
        .value,
    ).toBe('21')
    // 初期選択の緩和で開催紐付けが既定 ON になる範囲が広がることを明示的に固定する。
    expect(
      (container.querySelector('input[name="editionLink"]') as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      screen.getByText('「全国競技かるた杉並大会」の通称を入れました'),
    ).toBeDefined()
  })

  it('AC-46: 名寄せ候補が1件でも short_name が null のときは系列だけが選択され通称欄は空のまま', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesId: 22,
          seriesName: '無名大会',
          seriesShortName: null,
          editionNumber: 5,
          matched: false,
        }}
        seriesOptions={[{ id: 22, name: '無名大会', aliases: [], kind: 'individual' }]}
        action={noop}
      />,
    )

    expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe('')
    expect(
      (container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement)
        .value,
    ).toBe('22')
  })

  it('AC-47: 名寄せ候補が0件・複数件（seriesId が null）のときは通称欄も系列も未確定', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{
          seriesId: null,
          seriesName: '曖昧な大会',
          seriesShortName: null,
          editionNumber: 5,
          matched: false,
        }}
        seriesOptions={[{ id: 23, name: '別の大会', aliases: [], kind: 'individual' }]}
        action={noop}
      />,
    )

    expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe('')
    expect(
      (container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement)
        .value,
    ).toBe('')
  })

  it('AC-49: 通称欄に入力すると絞り込んだ系列候補チップが直下に表示される（空のときは出ない）', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        seriesOptions={[
          {
            id: 31,
            name: '全国競技かるた杉並大会',
            aliases: [],
            kind: 'individual',
            shortName: '杉並',
          },
          { id: 32, name: '別の大会', aliases: [], kind: 'individual' },
        ]}
        action={noop}
      />,
    )

    // 通称欄が空のあいだはチップを出さない。
    expect(screen.queryByRole('button', { name: /杉並/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '杉並' } })
    expect(
      screen.getByRole('button', { name: '杉並（全国競技かるた杉並大会）' }),
    ).toBeDefined()
  })

  it('AC-50: 候補チップをタップすると系列が確定し、通称欄の文字列は変化しない', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        seriesOptions={[
          {
            id: 31,
            name: '全国競技かるた杉並大会',
            aliases: [],
            kind: 'individual',
            shortName: '杉並',
          },
        ]}
        action={noop}
      />,
    )

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '杉並' } })
    fireEvent.click(
      screen.getByRole('button', { name: '杉並（全国競技かるた杉並大会）' }),
    )

    expect(
      (container.querySelector('input[name="editionSeriesId"]') as HTMLInputElement)
        .value,
    ).toBe('31')
    expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe('杉並')
    expect(
      (container.querySelector('input[name="editionLink"]') as HTMLInputElement)
        .checked,
    ).toBe(true)
  })

  it('AC-51: チップ確定後に通称を打ち直しても系列選択は保持され、チップだけ新しい入力に追従する', () => {
    const payload = buildPayload([buildUnit({ kind: 'individual' })])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        seriesOptions={[
          {
            id: 31,
            name: '全国競技かるた杉並大会',
            aliases: [],
            kind: 'individual',
            shortName: '杉並',
          },
          {
            id: 41,
            name: '全国競技かるた練馬大会',
            aliases: [],
            kind: 'individual',
            shortName: '練馬',
          },
        ]}
        action={noop}
      />,
    )

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '杉並' } })
    fireEvent.click(
      screen.getByRole('button', { name: '杉並（全国競技かるた杉並大会）' }),
    )
    const seriesId = container.querySelector(
      'input[name="editionSeriesId"]',
    ) as HTMLInputElement
    expect(seriesId.value).toBe('31')

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '練馬' } })
    expect(seriesId.value).toBe('31')
    expect(
      screen.getByRole('button', { name: '練馬（全国競技かるた練馬大会）' }),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /杉並/ })).toBeNull()
  })

  it('AC-52: 個人戦・団体戦が混在する案内では候補チップが表示されない', () => {
    const payload = buildPayload([
      buildUnit({ unit_key: 'u1', kind: 'team', event_date: '2030-12-01' }),
      buildUnit({ unit_key: 'u2', kind: 'individual', event_date: '2030-12-02' }),
    ])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem={null}
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        seriesOptions={[
          {
            id: 31,
            name: '全国競技かるた杉並大会',
            aliases: [],
            kind: 'individual',
            shortName: '杉並',
          },
        ]}
        action={noop}
      />,
    )

    fireEvent.change(screen.getByLabelText('通称'), { target: { value: '杉並' } })
    expect(screen.queryByRole('button', { name: /杉並/ })).toBeNull()
  })

  describe('AC-53: 系列検索シートで確定したとき通称欄へ short_name を入れる', () => {
    it('通称欄が空なら short_name が入る', () => {
      const payload = buildPayload([buildUnit({ kind: 'team' })])
      render(
        <ApprovalForm
          payload={payload}
          shortNameStem={null}
          registeredUnitKeys={[]}
          editionSuggestion={{
            seriesId: null,
            seriesName: '',
            editionNumber: 1,
            matched: false,
          }}
          seriesOptions={[
            {
              id: 7,
              name: 'こばえちゃ山形酒田大会',
              aliases: [],
              kind: 'team',
              shortName: '酒田',
            },
          ]}
          action={noop}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
      const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
      fireEvent.click(
        within(dialog).getByRole('radio', { name: /こばえちゃ山形酒田大会/ }),
      )
      fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

      expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe('酒田')
    })

    it('既に入力があれば変化しない', () => {
      const payload = buildPayload([buildUnit({ kind: 'team' })])
      render(
        <ApprovalForm
          payload={payload}
          shortNameStem="既存入力"
          registeredUnitKeys={[]}
          editionSuggestion={{
            seriesId: null,
            seriesName: '',
            editionNumber: 1,
            matched: false,
          }}
          seriesOptions={[
            {
              id: 7,
              name: 'こばえちゃ山形酒田大会',
              aliases: [],
              kind: 'team',
              shortName: '酒田',
            },
          ]}
          action={noop}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
      const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
      fireEvent.click(
        within(dialog).getByRole('radio', { name: /こばえちゃ山形酒田大会/ }),
      )
      fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

      expect((screen.getByLabelText('通称') as HTMLInputElement).value).toBe(
        '既存入力',
      )
    })
  })

  describe('editionSeriesShortName hidden field', () => {
    it('新規作成 (createNew) のとき通称の trim 値が入る', () => {
      const payload = buildPayload([buildUnit({ kind: 'team' })])
      const { container } = render(
        <ApprovalForm
          payload={payload}
          shortNameStem="  酒田  "
          registeredUnitKeys={[]}
          editionSuggestion={{
            seriesId: null,
            seriesName: '新設大会',
            editionNumber: 1,
            matched: false,
          }}
          seriesOptions={[]}
          action={noop}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
      const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
      fireEvent.click(
        within(dialog).getByRole('checkbox', {
          name: /「新設大会」を新しい系列として作成する/,
        }),
      )
      fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

      const shortName = container.querySelector(
        'input[name="editionSeriesShortName"]',
      ) as HTMLInputElement
      expect(shortName.value).toBe('酒田')
    })

    it('既存系列を選んだときは空文字になる', () => {
      const payload = buildPayload([buildUnit({ kind: 'team' })])
      const { container } = render(
        <ApprovalForm
          payload={payload}
          shortNameStem="酒田"
          registeredUnitKeys={[]}
          editionSuggestion={{
            seriesId: null,
            seriesName: '',
            editionNumber: 1,
            matched: false,
          }}
          seriesOptions={[
            { id: 7, name: 'こばえちゃ山形酒田大会', aliases: [], kind: 'team' },
          ]}
          action={noop}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '系列を検索・選択' }))
      const dialog = screen.getByRole('dialog', { name: '大会系列を検索' })
      fireEvent.click(
        within(dialog).getByRole('radio', { name: /こばえちゃ山形酒田大会/ }),
      )
      fireEvent.click(within(dialog).getByRole('button', { name: 'この系列を使う' }))

      const shortName = container.querySelector(
        'input[name="editionSeriesShortName"]',
      ) as HTMLInputElement
      expect(shortName.value).toBe('')
    })
  })
})

/** AC-39 / 全体定員: payload の新項目が承認フォームの送信値へ写ること。 */
describe('ApprovalForm — 新項目のマッピング', () => {
  it('AC-39: payment_deadline_kind の日本語3値が英語 enum に写る', () => {
    const cases: [string, string][] = [
      ['日付あり', 'fixed'],
      ['後日連絡', 'later_notice'],
      ['記載なし', 'unspecified'],
    ]
    for (const [payloadValue, expected] of cases) {
      const payload = buildPayload([
        buildUnit({
          payment_deadline: payloadValue === '日付あり' ? '2030-11-25' : null,
          payment_deadline_kind: payloadValue as EventUnit['payment_deadline_kind'],
        }),
      ])
      const { container, unmount } = render(
        <ApprovalForm
          payload={payload}
          shortNameStem="大阪"
          registeredUnitKeys={[]}
          editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
          action={noop}
        />,
      )
      const kindInput = container.querySelector(
        'input[name="u1__paymentDeadlineKind"]',
      ) as HTMLInputElement
      expect(kindInput.value).toBe(expected)
      unmount()
    }
  })

  it('capacity_total が events.capacity へ、級別は capacity_a〜e のまま併存する', () => {
    const payload = buildPayload([
      buildUnit({ capacity_total: 100, capacity_a: 32, capacity_b: 16 }),
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
    const capacity = container.querySelector(
      'input[name="u1__capacity"]',
    ) as HTMLInputElement
    const capA = container.querySelector(
      'input[name="u1__capacityA"]',
    ) as HTMLInputElement
    expect(capacity.value).toBe('100')
    expect(capA.value).toBe('32')
  })
})

/**
 * mail-ai-extract-refinements §3.2.12(d) / AC-70〜75・77: D・E 級の地域制限判定を
 * 承認フォームの初期値・警告表示へ反映する。
 */
describe('ApprovalForm — D・E級の地域制限判定（AC-70〜75・77）', () => {
  const D_QUOTE =
    'D級 初段の方 地域制限有 近畿支部及び隣接県（鳥取、岡山、徳島）の会所属、及び支部内在住・在勤・在学の方'
  const E_QUOTE =
    'E級 初段を目指す方。 地域制限有 兵庫県内の会所属、及び兵庫県内在住・在勤・在学の方'

  function re(overrides: Partial<RegionalEligibility>): RegionalEligibility {
    return { grade: 'D', verdict: '要確認', evidence_quote: null, ...overrides }
  }

  it('AC-70: 照合済み対象外の D・E を対象級の初期値から外し、大会名の合成にも反映する', () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['A', 'B', 'C', 'D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
          re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const title = container.querySelector('input[name="u1__title"]') as HTMLInputElement
    expect(title.value).toBe('兵庫ABC')

    const gradeChecked = (g: string) =>
      (container.querySelector(`input[name="u1__grade_${g}"]`) as HTMLInputElement).checked
    expect(gradeChecked('A')).toBe(true)
    expect(gradeChecked('B')).toBe(true)
    expect(gradeChecked('C')).toBe(true)
    expect(gradeChecked('D')).toBe(false)
    expect(gradeChecked('E')).toBe(false)
  })

  it('AC-71: 警告に外した級と両級の根拠の一文が出る', () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['A', 'B', 'C', 'D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
          re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    expect(
      screen.getByText('D級・E級を対象級から外しました（北海道の選手は出場できないため）'),
    ).toBeDefined()
    expect(screen.getByText(D_QUOTE)).toBeDefined()
    expect(screen.getByText(E_QUOTE)).toBeDefined()
    expect(screen.getByText('戻すには下の対象級を再チェックしてください')).toBeDefined()
  })

  it('AC-72: 未照合の対象外は外さず警告のみ、要確認も外さず注意のみ（quote null はフォールバック文言）', () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: false }),
          re({ grade: 'E', verdict: '要確認', evidence_quote: null }),
        ],
      }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    const gradeE = container.querySelector('input[name="u1__grade_E"]') as HTMLInputElement
    expect(gradeD.checked).toBe(true)
    expect(gradeE.checked).toBe(true)

    expect(
      screen.getByText(
        'D級は北海道は対象外と判定されましたが、根拠の一文を原文と照合できませんでした。確認してください',
      ),
    ).toBeDefined()
    expect(screen.getByText(D_QUOTE)).toBeDefined()

    expect(screen.getByText('E級の出場資格を確認してください')).toBeDefined()
    expect(screen.getByText('資格の記載が見当たりません')).toBeDefined()
  })

  it('AC-73: D・E のみの単位で両方照合済み対象外なら登録を既定 OFF にし、ON に戻すと送信できる', async () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
          re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    const actionSpy = vi.fn()
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={actionSpy}
      />,
    )

    const register = container.querySelector('input[name="u1__register"]') as HTMLInputElement
    expect(register.checked).toBe(false)
    expect(
      screen.getByText(
        'この日の全ての級が北海道の選手は出場できないため、登録対象から外しました。他に登録する日が無ければ却下してください',
      ),
    ).toBeDefined()

    const fieldset = container.querySelector('fieldset') as HTMLFieldSetElement
    expect(fieldset.disabled).toBe(true)

    fireEvent.click(register)
    expect(fieldset.disabled).toBe(false)

    const form = container.querySelector('form') as HTMLFormElement
    const fd = new FormData(form)
    expect(fd.get('u1__register')).toBe('on')

    // Codex レビュー（PR #618）: 級を1つも選ばずに送信すると eligible_grades が
    // null（=全級扱い）で保存されてしまうので、クライアント側で送信を止める。
    // React 19 のフォーム action は submit を常に preventDefault するので、
    // 「止まったか」は defaultPrevented ではなく action の呼び出し有無で見る。
    fireEvent.submit(form)
    expect(screen.getByText(/対象級を1つ以上選んでください/)).toBeDefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(actionSpy).not.toHaveBeenCalled()

    // 級を1つ選び直せば通常どおり送信できる（AC-73「ON に戻せば登録できる」）。
    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    fireEvent.click(gradeD)
    expect(gradeD.checked).toBe(true)
    fireEvent.submit(form)
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/対象級を1つ以上選んでください/)).toBeNull()
  })

  it('AC-73: 一部の級だけ自動除外された単位でも、残りの級を外して送信すると止まる', async () => {
    // Codex レビュー（PR #618 final）: A・D のうち D が照合済み対象外 → 初期値は A だけ。
    // 管理者が A のチェックも外して送信すると eligible_grades が null（=全級）になり、
    // 自動除外した D まで対象に戻ってしまう。allRemoved でなくても止める。
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['A', 'D'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    const actionSpy = vi.fn()
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={actionSpy}
      />,
    )
    const form = container.querySelector('form') as HTMLFormElement
    const gradeA = container.querySelector('input[name="u1__grade_A"]') as HTMLInputElement
    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    expect(gradeA.checked).toBe(true)
    expect(gradeD.checked).toBe(false)

    fireEvent.click(gradeA)
    expect(gradeA.checked).toBe(false)
    fireEvent.submit(form)
    expect(screen.getByText(/対象級を1つ以上選んでください/)).toBeDefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(actionSpy).not.toHaveBeenCalled()

    fireEvent.click(gradeA)
    fireEvent.submit(form)
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/対象級を1つ以上選んでください/)).toBeNull()
  })

  it('AC-73: AI が級を読めなかった単位（eligible_grades null）は級未選択でも送信を止めない', async () => {
    // null=全級は既存仕様。地域制限で全級を外した単位だけがガードの対象。
    const payload = buildPayload([
      buildUnit({ eligible_grades: null, regional_eligibility: [] }),
    ])
    const actionSpy = vi.fn()
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={actionSpy}
      />,
    )
    const form = container.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
    await waitFor(() => expect(actionSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/対象級を1つ以上選んでください/)).toBeNull()
  })

  it('AC-74: 北海道は対象は外さず補足のみ、制限なしは表示に出ない', () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '制限なし', evidence_quote: '参加者の地域制限は設けません' }),
          re({
            grade: 'E',
            verdict: '北海道は対象',
            evidence_quote: '北海道在住の方も対象です',
            evidence_verified: true,
          }),
        ],
      }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    const gradeE = container.querySelector('input[name="u1__grade_E"]') as HTMLInputElement
    expect(gradeD.checked).toBe(true)
    expect(gradeE.checked).toBe(true)

    expect(screen.getByText('E級は地域制限ありですが北海道は対象です')).toBeDefined()
    expect(screen.getByText('北海道在住の方も対象です')).toBeDefined()
    // D は「制限なし」なので通知が一切出ない。checkbox のラベル文言「D級」自体は
    // grade チェックボックスにも存在するため、通知固有の言い回しでだけ確認する。
    expect(screen.queryByText(/D級(は|の|・|を対象級)/)).toBeNull()
    expect(screen.queryByText('参加者の地域制限は設けません')).toBeNull()
  })

  it('AC-75: regional_eligibility を持たない旧ドラフトでは何も外れず表示も出ない', () => {
    const legacyUnit = buildUnit({ eligible_grades: ['D', 'E'] }) as Record<string, unknown>
    delete legacyUnit.regional_eligibility
    const payload = buildPayload([legacyUnit as unknown as EventUnit])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    const gradeE = container.querySelector('input[name="u1__grade_E"]') as HTMLInputElement
    expect(gradeD.checked).toBe(true)
    expect(gradeE.checked).toBe(true)
    // grade チェックボックスのラベル文言「D級」「E級」自体は EventForm が常に
    // 描画するので、通知固有の言い回しでだけ「何も出ていない」ことを確認する。
    expect(screen.queryByText(/D級(は|の|・|を対象級)/)).toBeNull()
    expect(screen.queryByText(/E級(は|の|・|を対象級)/)).toBeNull()
    expect(screen.queryByText(D_QUOTE)).toBeNull()
    expect(screen.queryByText(E_QUOTE)).toBeNull()
  })

  it('AC-75: 登録済み単位には地域制限の表示を出さない', () => {
    const payload = buildPayload([
      buildUnit({
        unit_key: 'u1',
        eligible_grades: ['D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
          re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[{ unitKey: 'u1', eventId: 1 }]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    expect(screen.queryByText(/D級/)).toBeNull()
    expect(screen.queryByText(/E級/)).toBeNull()
  })

  it('AC-77: 外れた級を再チェックすると送信データに乗る（大会名は再合成しない）', () => {
    const payload = buildPayload([
      buildUnit({
        eligible_grades: ['A', 'B', 'C', 'D', 'E'],
        regional_eligibility: [
          re({ grade: 'D', verdict: '北海道は対象外', evidence_quote: D_QUOTE, evidence_verified: true }),
          re({ grade: 'E', verdict: '北海道は対象外', evidence_quote: E_QUOTE, evidence_verified: true }),
        ],
      }),
    ])
    const { container } = render(
      <ApprovalForm
        payload={payload}
        shortNameStem="兵庫"
        registeredUnitKeys={[]}
        editionSuggestion={{ seriesName: '', editionNumber: null, matched: false }}
        action={noop}
      />,
    )

    const gradeD = container.querySelector('input[name="u1__grade_D"]') as HTMLInputElement
    expect(gradeD.checked).toBe(false)
    fireEvent.click(gradeD)
    expect(gradeD.checked).toBe(true)

    const form = container.querySelector('form') as HTMLFormElement
    const fd = new FormData(form)
    expect(fd.get('u1__grade_D')).toBe('on')
    expect(fd.get('u1__title')).toBe('兵庫ABC')
  })
})
