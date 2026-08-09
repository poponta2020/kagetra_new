import { describe, expect, it } from 'vitest'
import { deriveHistory, type HistoryRow } from './mail-history'
import type { HistoryEventRef, HistoryInput } from './mail-history.queries'

/**
 * mail-history.ts の純関数テスト（DB 非依存）。requirements.md §3.4 H0〜H6。
 */

const EVENT_A: HistoryEventRef = { id: 101, title: '多摩A', eventDate: '2026-07-11' }
const EVENT_B: HistoryEventRef = { id: 102, title: '多摩B', eventDate: '2026-07-12' }
const NON_COLLAPSIBLE_1: HistoryEventRef = { id: 201, title: '第46回九段大会', eventDate: '2026-08-02' }
const NON_COLLAPSIBLE_2: HistoryEventRef = { id: 202, title: '第79回福井大会', eventDate: '2026-07-19' }

function baseInput(overrides: Partial<HistoryInput> = {}): HistoryInput {
  return {
    mailId: 1,
    triageStatus: 'processed',
    triagedAt: null,
    mailKind: null,
    linkedEvents: [],
    draft: null,
    broadcasts: [],
    ...overrides,
  }
}

/** 履歴行のテキスト部分をつなげた文字列（segments+detail+note）。日付文字列の混入検査に使う。 */
function flatten(row: HistoryRow): string {
  const segText = row.segments.map((s) => (s.type === 'text' ? s.value : s.label)).join('')
  return [segText, row.detail ?? '', row.note ?? ''].join('')
}

describe('deriveHistory — H1 大会案内として処理', () => {
  it('大会名リンク付きで「の案内として処理」になる', () => {
    const input = baseInput({
      draft: { approvedAt: new Date('2026-08-02T00:00:00Z'), events: [EVENT_A, EVENT_B] },
    })
    const [row] = deriveHistory(input)
    expect(row!.kind).toBe('draft_approved')
    expect(row!.segments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩AB' },
      { type: 'text', value: ' の案内として処理' },
    ])
    expect(row!.summarySegments).toEqual(row!.segments)
    expect(row!.detail).toBeNull()
  })

  it('対象イベントが1件も引けない場合は大会名部分が落ちる', () => {
    const input = baseInput({
      draft: { approvedAt: new Date('2026-08-02T00:00:00Z'), events: [] },
    })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([{ type: 'text', value: '大会案内として処理' }])
  })
})

describe('deriveHistory — H2 LINEグループへ配信（AC-13, AC-14, AC-15）', () => {
  it('include_body=true かつ添付N件で「本文と添付N件」', () => {
    const input = baseInput({
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: true, attachmentCount: 2, events: [EVENT_A] },
      ],
    })
    const [row] = deriveHistory(input)
    expect(row!.detail).toBe('（本文と添付2件）')
  })

  it('include_body=true かつ添付0件で「本文のみ」', () => {
    const input = baseInput({
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: true, attachmentCount: 0, events: [EVENT_A] },
      ],
    })
    const [row] = deriveHistory(input)
    expect(row!.detail).toBe('（本文のみ）')
  })

  it('AC-14: include_body=false のとき「本文と」を含まず添付件数のみ表示する', () => {
    const input = baseInput({
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: false, attachmentCount: 3, events: [EVENT_A] },
      ],
    })
    const [row] = deriveHistory(input)
    expect(row!.detail).toBe('（添付3件）')
    expect(row!.detail).not.toContain('本文と')
  })

  it('include_body=false かつ添付0件も「本文のみ」', () => {
    const input = baseInput({
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: false, attachmentCount: 0, events: [EVENT_A] },
      ],
    })
    const [row] = deriveHistory(input)
    expect(row!.detail).toBe('（本文のみ）')
  })

  it('summarySegments は詳細と異なる短縮文言（LINE配信）になる', () => {
    const input = baseInput({
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: true, attachmentCount: 1, events: [EVENT_A] },
      ],
    })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩A' },
      { type: 'text', value: ' の連絡としてLINEグループへ配信' },
    ])
    expect(row!.summarySegments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩A' },
      { type: 'text', value: ' の連絡としてLINE配信' },
    ])
    expect(row!.summarySegments).not.toEqual(row!.segments)
  })

  // AC-15 は「status='sent' 以外を渡さない」契約が loadHistoryInputs 側の責務。
  // ここでは broadcasts 配列に来た要素は無条件に H2 行になることだけを固定する
  // （フィルタ済み入力を信頼する契約は mail-history.queries.test.ts 側で検証）。
})

describe('deriveHistory — H3 紐付け（AC-16）', () => {
  it('mail_kind が applicant_roster なら「申込名簿として処理」になる', () => {
    const input = baseInput({ mailKind: 'applicant_roster', linkedEvents: [EVENT_A] })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩A' },
      { type: 'text', value: ' の申込名簿として処理' },
    ])
  })

  it('mail_kind が confirmed_roster なら「確定名簿として処理」になる', () => {
    const input = baseInput({ mailKind: 'confirmed_roster', linkedEvents: [EVENT_A] })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩A' },
      { type: 'text', value: ' の確定名簿として処理' },
    ])
  })

  it('mail_kind が null なら「の連絡として紐付け」になる', () => {
    const input = baseInput({ mailKind: null, linkedEvents: [EVENT_A] })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([
      { type: 'eventLink', eventId: EVENT_A.id, label: '多摩A' },
      { type: 'text', value: ' の連絡として紐付け' },
    ])
  })

  it('H2 が有るときは H3 を出さない', () => {
    const input = baseInput({
      linkedEvents: [EVENT_A],
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: true, attachmentCount: 0, events: [EVENT_A] },
      ],
    })
    const rows = deriveHistory(input)
    expect(rows.map((r) => r.kind)).toEqual(['broadcast'])
  })
})

describe('deriveHistory — H4/H5 対応不要として処理（AC-17, AC-18）', () => {
  it('triaged_at があれば H4「対応不要として処理」（日付あり）', () => {
    const input = baseInput({ triagedAt: new Date('2026-08-03T00:00:00Z') })
    const [row] = deriveHistory(input)
    expect(row!.kind).toBe('dismissed')
    expect(row!.at).toEqual(new Date('2026-08-03T00:00:00Z'))
    expect(row!.segments).toEqual([{ type: 'text', value: '対応不要として処理' }])
    expect(row!.note).toBeNull()
  })

  it('AC-18: triaged_at が無ければ H5。at は null で、行の要素に日付文字列を含まない', () => {
    const input = baseInput({ triagedAt: null })
    const [row] = deriveHistory(input)
    expect(row!.kind).toBe('dismissed')
    expect(row!.at).toBeNull()
    expect(row!.segments).toEqual([{ type: 'text', value: '対応不要として処理済み' }])
    expect(row!.note).toBe('処理日時の記録がありません')
    const flat = flatten(row!)
    expect(flat).not.toMatch(/年/)
    expect(flat).not.toMatch(/月/)
  })
})

describe('deriveHistory — H6 未処理（AC-10 の前提）', () => {
  it('triage_status が unprocessed なら空配列', () => {
    const input = baseInput({ triageStatus: 'unprocessed', triagedAt: null })
    expect(deriveHistory(input)).toEqual([])
  })
})

describe('deriveHistory — 並び順（AC-19）', () => {
  it('複数行が日時昇順に並ぶ', () => {
    const input = baseInput({
      mailKind: null,
      linkedEvents: [],
      draft: { approvedAt: new Date('2026-08-02T00:00:00Z'), events: [EVENT_A] },
      broadcasts: [
        { sentAt: new Date('2026-08-04T00:00:00Z'), includeBody: true, attachmentCount: 0, events: [EVENT_B] },
      ],
    })
    const rows = deriveHistory(input)
    expect(rows.map((r) => r.kind)).toEqual(['draft_approved', 'broadcast'])
    expect(rows[0]!.at!.getTime()).toBeLessThan(rows[1]!.at!.getTime())
  })
})

describe('deriveHistory — extraRows（H0 注入・AC-32, AC-33）', () => {
  it('AC-33: extraRows を渡さない構成でも H1〜H6 の導出が成立する', () => {
    // H1
    expect(
      deriveHistory(baseInput({ draft: { approvedAt: new Date(), events: [EVENT_A] } }))[0]!.kind,
    ).toBe('draft_approved')
    // H2
    expect(
      deriveHistory(
        baseInput({
          broadcasts: [{ sentAt: new Date(), includeBody: true, attachmentCount: 0, events: [EVENT_A] }],
        }),
      )[0]!.kind,
    ).toBe('broadcast')
    // H3
    expect(deriveHistory(baseInput({ linkedEvents: [EVENT_A] }))[0]!.kind).toBe('linked')
    // H4
    expect(deriveHistory(baseInput({ triagedAt: new Date() }))[0]!.kind).toBe('dismissed')
    // H5
    expect(deriveHistory(baseInput({ triagedAt: null }))[0]!.at).toBeNull()
    // H6
    expect(deriveHistory(baseInput({ triageStatus: 'unprocessed' }))).toEqual([])
  })

  it('AC-32: extraRows に H0 行を渡すと H4（対応不要として処理）が出ない', () => {
    const h0Row: HistoryRow = {
      kind: 'result_import',
      at: new Date('2026-07-21T00:00:00Z'),
      segments: [{ type: 'text', value: '試合結果として取り込み' }],
      detail: null,
      note: null,
      summarySegments: [{ type: 'text', value: '試合結果として取り込み' }],
    }
    // H1〜H3 は無いが H0 があるので、消去法の「対応不要」には落ちない。
    const rows = deriveHistory(baseInput({ triagedAt: new Date('2026-08-03T00:00:00Z') }), [h0Row])
    expect(rows.map((r) => r.kind)).toEqual(['result_import'])
    expect(rows.some((r) => r.kind === 'dismissed')).toBe(false)
  })

  it('extraRows が空でも H1〜H3 が0行なら通常どおり H4/H5 に落ちる', () => {
    const rows = deriveHistory(baseInput({ triagedAt: new Date('2026-08-03T00:00:00Z') }), [])
    expect(rows.map((r) => r.kind)).toEqual(['dismissed'])
  })
})

describe('対象大会ラベルの共通規則（AC-12, AC-20）', () => {
  it('deriveEntryGroupName で畳めるとき単一ラベル＋開催日が最も早いイベントへの link', () => {
    // EVENT_A(7/11) と EVENT_B(7/12) は多摩A/多摩B → 「多摩AB」に畳める。開催日が
    // 早いのは EVENT_A なのでリンク先は EVENT_A.id になる（selectRepresentativeEvent
    // の「次回優先/無ければ最新」ではなく、常に開催日最速）。
    const input = baseInput({ draft: { approvedAt: new Date(), events: [EVENT_B, EVENT_A] } })
    const [row] = deriveHistory(input)
    const [first] = row!.segments
    expect(first).toEqual({ type: 'eventLink', eventId: EVENT_A.id, label: '多摩AB' })
  })

  it('畳めないとき全件併記でそれぞれ link（開催日昇順）', () => {
    const input = baseInput({
      draft: { approvedAt: new Date(), events: [NON_COLLAPSIBLE_1, NON_COLLAPSIBLE_2] },
    })
    const [row] = deriveHistory(input)
    // NON_COLLAPSIBLE_2 (7/19) が NON_COLLAPSIBLE_1 (8/2) より開催日が早いので先に来る。
    expect(row!.segments.slice(0, 3)).toEqual([
      { type: 'eventLink', eventId: NON_COLLAPSIBLE_2.id, label: NON_COLLAPSIBLE_2.title },
      { type: 'text', value: '・' },
      { type: 'eventLink', eventId: NON_COLLAPSIBLE_1.id, label: NON_COLLAPSIBLE_1.title },
    ])
  })

  it('0件のとき eventLink 無しで文言から大会名が落ちる', () => {
    const input = baseInput({
      broadcasts: [{ sentAt: new Date(), includeBody: true, attachmentCount: 0, events: [] }],
    })
    const [row] = deriveHistory(input)
    expect(row!.segments).toEqual([{ type: 'text', value: 'LINEグループへ配信' }])
    expect(row!.summarySegments).toEqual([{ type: 'text', value: 'LINE配信' }])
    expect(row!.segments.some((s) => s.type === 'eventLink')).toBe(false)
  })
})
