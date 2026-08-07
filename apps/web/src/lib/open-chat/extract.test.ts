import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractOpenChatCandidates,
  mergeOpenChatCandidateLists,
} from './extract'

// 実在の招待 URL トークンは使わず、feasibility.md / design-spec.md と同じ方針で
// 架空トークン（英数字33桁 = 実測値と同じ桁数）に置き換える。
const TOKEN_A = 'A'.repeat(33)
const TOKEN_B = 'B'.repeat(33)
const TOKEN_C = 'C'.repeat(33)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extractOpenChatCandidates — Tier1 直リンク', () => {
  it('AC-1: line.me/ti/g2/<token> を候補として抽出する', () => {
    const text = `オープンチャットはこちら\nhttps://line.me/ti/g2/${TOKEN_A}\nよろしくお願いします`
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      url: `https://line.me/ti/g2/${TOKEN_A}`,
      sources: ['body'],
      unverified: false,
      grades: null,
      eventDate: null,
      password: null,
    })
  })

  it('AC-4: line.me/R/ti/g2/<token>（末尾の2の有無どちらも）を抽出する', () => {
    const withTwo = extractOpenChatCandidates(
      `https://line.me/R/ti/g2/${TOKEN_A}`,
      { source: 'body', groupEventDates: [] },
    )
    expect(withTwo).toHaveLength(1)
    expect(withTwo[0].url).toBe(`https://line.me/R/ti/g2/${TOKEN_A}`)

    const withoutTwo = extractOpenChatCandidates(
      `https://line.me/R/ti/g/${TOKEN_B}`,
      { source: 'body', groupEventDates: [] },
    )
    expect(withoutTwo).toHaveLength(1)
    expect(withoutTwo[0].url).toBe(`https://line.me/R/ti/g/${TOKEN_B}`)
  })

  it('AC-2: 改行でトークンが分断された URL を結合して復元する', () => {
    const splitAt = 20
    const text = `https://line.me/ti/g2/${TOKEN_A.slice(0, splitAt)}\n${TOKEN_A.slice(splitAt)}`
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe(`https://line.me/ti/g2/${TOKEN_A}`)
  })

  it('AC-2: feasibility.md 実例（さがみ野 mail#208。クエリ側が改行で割れるがトークンは無傷）でも抽出できる', () => {
    // feasibility.md §2-4 の実文面（架空トークンへ置換済み）。
    const text =
      'https://line.me/ti/g2/SampleTokenFfGgHhIiJjKkLlMmNnOoPp?utm_source=invi\n' +
      'tation&utm_medium=link_copy&utm_campaign=default'
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(1)
    // クエリ文字列は正規化の過程で落ちる（トークンの文字集合に '?' が含まれないため
    // マッチが自然に止まる＝正規化後の URL そのもの）。
    expect(result[0].url).toBe('https://line.me/ti/g2/SampleTokenFfGgHhIiJjKkLlMmNnOoPp')
  })

  it('AC-3: 改行の先が復元不能（非英数字で途切れる）な候補は提示しない', () => {
    const text = `https://line.me/ti/g2/${TOKEN_A.slice(0, 10)}\n続きは次のページの通り`
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(0)
  })

  it('AC-3: 改行の先を結合しても規定の桁数（33文字）に一致しない候補は提示しない', () => {
    const text = `https://line.me/ti/g2/${TOKEN_A.slice(0, 10)}\nExtra`
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(0)
  })

  it('AC-5: Outlook の `<https://...>` 二重表記は同一 URL として1候補にまとまる', () => {
    const text = `ご案内: https://line.me/ti/g2/${TOKEN_A}\n<https://line.me/ti/g2/${TOKEN_A}>`
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['body'])
  })

  it('AC-6: source に attachment_text を渡すと候補の出典が attachment_text になる', () => {
    const text = `添付内オープンチャット案内: https://line.me/ti/g2/${TOKEN_A}`
    const result = extractOpenChatCandidates(text, {
      source: 'attachment_text',
      groupEventDates: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['attachment_text'])
  })
})

describe('extractOpenChatCandidates — Tier2 短縮 URL', () => {
  it('AC-7: 対象5ドメインすべてを unverified 付きで候補に出す', () => {
    const text = [
      'https://x.gd/aB3xQ',
      'https://ourl.jp/Zx1Aq',
      'https://lin.ee/AbCdEf',
      'https://bit.ly/3xYzAbc',
      'https://tinyurl.com/abc123def',
    ].join('\n')
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(5)
    for (const candidate of result) {
      expect(candidate.unverified).toBe(true)
    }
  })
})

describe('extractOpenChatCandidates — AC-8 fetch を呼ばない', () => {
  it('抽出処理中に globalThis.fetch が一度も呼ばれない', () => {
    // globalThis.fetch が未定義だと spyOn 自体が失敗するため、先に実体化を確認する。
    expect(typeof globalThis.fetch).toBe('function')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const text = [
      `https://line.me/ti/g2/${TOKEN_A}`,
      'https://x.gd/aB3xQ',
      'https://ourl.jp/Zx1Aq',
    ].join('\n')
    extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('mergeOpenChatCandidateLists', () => {
  it('AC-9: 同一 URL が本文と添付の両方にある場合、1候補にまとまり出典が併記される', () => {
    const bodyCandidates = extractOpenChatCandidates(
      `本文案内: https://line.me/ti/g2/${TOKEN_A}`,
      { source: 'body', groupEventDates: [] },
    )
    const attachmentCandidates = extractOpenChatCandidates(
      `添付案内: https://line.me/ti/g2/${TOKEN_A}`,
      { source: 'attachment_text', groupEventDates: [] },
    )
    const merged = mergeOpenChatCandidateLists([bodyCandidates, attachmentCandidates])
    expect(merged).toHaveLength(1)
    expect([...merged[0].sources].sort()).toEqual(['attachment_text', 'body'])
  })

  it('異なる URL はマージしても別候補のまま残る', () => {
    const list1 = extractOpenChatCandidates(`https://line.me/ti/g2/${TOKEN_A}`, {
      source: 'body',
      groupEventDates: [],
    })
    const list2 = extractOpenChatCandidates(`https://line.me/ti/g2/${TOKEN_B}`, {
      source: 'attachment_text',
      groupEventDates: [],
    })
    const merged = mergeOpenChatCandidateLists([list1, list2])
    expect(merged).toHaveLength(2)
  })
})

describe('extractOpenChatCandidates — 級・開催日・パスワードの推定（§3.2.4）', () => {
  it('AC-16: 半角「D級:」・全角「【Ｃ級】」いずれからも対象級を推定する', () => {
    const dGrade = extractOpenChatCandidates(`D級：https://line.me/ti/g2/${TOKEN_A}`, {
      source: 'body',
      groupEventDates: [],
    })
    expect(dGrade[0].grades).toEqual(['D'])

    const cGradeFullWidth = extractOpenChatCandidates(
      `【Ｃ級】https://line.me/ti/g2/${TOKEN_B}`,
      { source: 'body', groupEventDates: [] },
    )
    expect(cGradeFullWidth[0].grades).toEqual(['C'])
  })

  it('AC-17: 「6/20(土)：」から対象開催日を推定する。グループ内に無い日は推定しない', () => {
    const inGroup = extractOpenChatCandidates(
      `6/20(土)：https://line.me/ti/g2/${TOKEN_A}`,
      { source: 'body', groupEventDates: ['2026-06-20', '2026-06-21'] },
    )
    expect(inGroup[0].eventDate).toBe('2026-06-20')

    const outOfGroup = extractOpenChatCandidates(
      `6/22：https://line.me/ti/g2/${TOKEN_B}`,
      { source: 'body', groupEventDates: ['2026-06-20'] },
    )
    expect(outOfGroup[0].eventDate).toBeNull()
  })

  it('AC-18: URL 前後どちらの「パスワード：」「合言葉：」も推定する', () => {
    const before = extractOpenChatCandidates(
      `パスワード：ABCD1234 https://line.me/ti/g2/${TOKEN_A}`,
      { source: 'body', groupEventDates: [] },
    )
    expect(before[0].password).toBe('ABCD1234')

    const after = extractOpenChatCandidates(
      `https://line.me/ti/g2/${TOKEN_B} 合言葉：xyz789`,
      { source: 'body', groupEventDates: [] },
    )
    expect(after[0].password).toBe('xyz789')
  })

  it('AC-19: 推定できない項目は未指定のまま提示され、エラーにならない', () => {
    const result = extractOpenChatCandidates(`https://line.me/ti/g2/${TOKEN_A}`, {
      source: 'body',
      groupEventDates: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ grades: null, eventDate: null, password: null })
  })
})

describe('extractOpenChatCandidates — 実文面ベースのケース', () => {
  it('東京東会: 級別3本（短縮 URL）は各行の級を推定し、全て unverified になる', () => {
    const text = ['D級：https://x.gd/tokyoD1', 'C級：https://x.gd/tokyoC1', 'B級：https://x.gd/tokyoB1'].join(
      '\n',
    )
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.grades)).toEqual([['D'], ['C'], ['B']])
    for (const c of result) expect(c.unverified).toBe(true)
  })

  it('杉並: 開催日別2本（直リンク）はそれぞれの開催日を推定し、他方の候補に日付が混入しない', () => {
    const text = [
      `6/20(土)：https://line.me/ti/g2/${TOKEN_A}`,
      `6/21(日)：https://line.me/ti/g2/${TOKEN_B}`,
    ].join('\n')
    const result = extractOpenChatCandidates(text, {
      source: 'body',
      groupEventDates: ['2026-06-20', '2026-06-21'],
    })
    expect(result).toHaveLength(2)
    expect(result[0].eventDate).toBe('2026-06-20')
    expect(result[1].eventDate).toBe('2026-06-21')
  })

  it('中学生選手権: 部門別5本（級でも日付でもない分かれ方）は級・日付とも未指定になる', () => {
    const text = [
      '団体戦：https://ourl.jp/dept1',
      '1年：https://ourl.jp/dept2',
      '2年：https://ourl.jp/dept3',
      '3年：https://ourl.jp/dept4',
      '選抜の部：https://ourl.jp/dept5',
    ].join('\n')
    const result = extractOpenChatCandidates(text, { source: 'body', groupEventDates: [] })
    expect(result).toHaveLength(5)
    for (const c of result) {
      expect(c.grades).toBeNull()
      expect(c.eventDate).toBeNull()
      expect(c.unverified).toBe(true)
    }
  })

  it('宮崎: 直リンク1本のみのシンプルなケース', () => {
    const result = extractOpenChatCandidates(`オープンチャットはこちらから\nhttps://line.me/ti/g2/${TOKEN_C}`, {
      source: 'body',
      groupEventDates: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0].unverified).toBe(false)
  })
})
