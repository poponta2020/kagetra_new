import { describe, expect, it } from 'vitest'
import { buildAiNotices, type AiNoticeDraftInput } from './ai-notice'

function baseDraft(overrides: Partial<AiNoticeDraftInput> = {}): AiNoticeDraftInput {
  return {
    aiRouting: null,
    aiError: null,
    extractionSource: null,
    parserVersion: 'v1',
    ...overrides,
  }
}

function baseRouting(overrides: Record<string, unknown> = {}) {
  return {
    verdict: 'adopt',
    outOfScopeKind: null,
    classMap: [],
    meta: {
      tournamentName: null,
      editionNumber: null,
      eventDate: null,
      isCorrection: false,
    },
    issues: [],
    ...overrides,
  }
}

describe('buildAiNotices', () => {
  // AI 列が全て null（＝AI を通していない旧データ）→ カード自体を出さない。
  it('AI 列が全て null なら空配列を返す', () => {
    expect(buildAiNotices(baseDraft())).toEqual([])
  })

  // AC-3: fail-open した際は「AI 検証なし」を warn トーンで出す。
  it('aiError があれば「AI 検証なし」を warn で出す', () => {
    const notices = buildAiNotices(baseDraft({ aiError: 'Anthropic timeout' }))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ tone: 'warn', title: 'AI 検証なし' })
    expect(notices[0]!.body).toContain('AI 呼び出しが失敗したため')
    expect(notices[0]!.body).toContain('Anthropic timeout')
  })

  // AC-3: out_of_scope は danger トーンの警告。kind ごとに文言が変わる。
  it.each([
    ['team', '団体戦の結果の可能性があります。'],
    ['roster_or_lottery', '出場者名簿・抽選結果の可能性があります。'],
    ['other', '大会結果ではない可能性があります。'],
  ] as const)('verdict=out_of_scope(%s) は danger の対象外警告を出す', (kind, expectedPrefix) => {
    const notices = buildAiNotices(
      baseDraft({
        aiRouting: baseRouting({ verdict: 'out_of_scope', outOfScopeKind: kind }),
      }),
    )
    const notice = notices.find((n) => n.title === '対象外の可能性')
    expect(notice).toBeDefined()
    expect(notice!.tone).toBe('danger')
    expect(notice!.body).toContain(expectedPrefix)
    expect(notice!.body).toContain('取り込む前に内容を必ず確認してください')
  })

  // AC-17: 訂正版・再送の可能性は warn トーンで差し替え検討を促す。
  it('meta.isCorrection が true なら訂正版促しを warn で出す', () => {
    const notices = buildAiNotices(
      baseDraft({ aiRouting: baseRouting({ meta: { ...baseRouting().meta, isCorrection: true } }) }),
    )
    const notice = notices.find((n) => n.title === '訂正版の可能性')
    expect(notice).toBeDefined()
    expect(notice!.tone).toBe('warn')
    expect(notice!.body).toContain('差し替えを検討してください')
  })

  // AC-9: AI 抽出由来（決定的パーサではない）は info トーンで parserVersion も併記。
  it('extractionSource が ai なら AI 抽出由来を info で出し parserVersion を含む', () => {
    const notices = buildAiNotices(baseDraft({ extractionSource: 'ai', parserVersion: 'v3.2.0' }))
    const notice = notices.find((n) => n.title === 'AI 抽出（要注意レビュー）')
    expect(notice).toBeDefined()
    expect(notice!.tone).toBe('info')
    expect(notice!.body).toContain('v3.2.0')
  })

  // issues は箇条書き用に items 配列で渡す。
  it('issues が非空なら neutral トーンで items に列挙する', () => {
    const notices = buildAiNotices(
      baseDraft({ aiRouting: baseRouting({ issues: ['級名が判読不能', '参加者数が0名'] }) }),
    )
    const notice = notices.find((n) => n.title === 'AI からの指摘事項')
    expect(notice).toBeDefined()
    expect(notice!.tone).toBe('neutral')
    expect(notice!.items).toEqual(['級名が判読不能', '参加者数が0名'])
  })

  // 複数条件が同時に成立すれば、それぞれの notice が併存する。
  it('複数条件が重なれば複数の notice を返す', () => {
    const notices = buildAiNotices(
      baseDraft({
        aiRouting: baseRouting({
          meta: { ...baseRouting().meta, isCorrection: true },
          issues: ['級名が判読不能'],
        }),
        extractionSource: 'ai',
      }),
    )
    expect(notices.map((n) => n.title)).toEqual([
      '訂正版の可能性',
      'AI 抽出（要注意レビュー）',
      'AI からの指摘事項',
    ])
  })
})
