import { describe, expect, it } from 'vitest'
import { buildOpenChatFlexMessage, type OpenChatFlexRow } from './flex'

/**
 * Flex JSON 木を再帰的に走査し、指定した type のノードを出現順に集める。
 * ネストの深さ (box の入れ子) をテスト側が意識せずに済むようにするヘルパー。
 */
function collectByType(
  node: unknown,
  type: string,
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (node && typeof node === 'object') {
    if (Array.isArray(node)) {
      for (const item of node) collectByType(item, type, out)
    } else {
      const obj = node as Record<string, unknown>
      if (obj.type === type) out.push(obj)
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') collectByType(value, type, out)
      }
    }
  }
  return out
}

function makeRow(overrides: Partial<OpenChatFlexRow> = {}): OpenChatFlexRow {
  return {
    url: 'https://line.me/ti/g2/dummyToken',
    label: 'オープンチャットに参加',
    password: null,
    ...overrides,
  }
}

describe('buildOpenChatFlexMessage', () => {
  it('1件のときバブル1つ・ボタン1つになる (type: flex / bubble)', () => {
    const msg = buildOpenChatFlexMessage([makeRow()], '鳳玉大会CD級')
    expect(msg.type).toBe('flex')
    expect(msg.contents.type).toBe('bubble')
    expect(collectByType(msg.contents, 'button')).toHaveLength(1)
  })

  it('3件・5件でも carousel にせずボタンが縦一列 (バブル1つ) に並ぶ', () => {
    const rows3: OpenChatFlexRow[] = [
      makeRow({ label: 'B級', url: 'https://line.me/ti/g2/tokenB' }),
      makeRow({ label: 'C級', url: 'https://line.me/ti/g2/tokenC' }),
      makeRow({ label: 'D級', url: 'https://line.me/ti/g2/tokenD' }),
    ]
    const msg3 = buildOpenChatFlexMessage(rows3, '東京東会大会BCD級')
    expect(msg3.contents.type).toBe('bubble')
    expect(collectByType(msg3.contents, 'button')).toHaveLength(3)
    expect(JSON.stringify(msg3.contents)).not.toContain('carousel')

    const rows5: OpenChatFlexRow[] = ['団体戦', '1年の部', '2年の部', '3年の部', '選抜の部'].map(
      (label, i) => makeRow({ label, url: `https://line.me/ti/g2/tokenX${i}` }),
    )
    const msg5 = buildOpenChatFlexMessage(rows5, '中学生選手権')
    expect(msg5.contents.type).toBe('bubble')
    expect(collectByType(msg5.contents, 'button')).toHaveLength(5)
    expect(JSON.stringify(msg5.contents)).not.toContain('carousel')
  })

  it('AC-31: パスワードのある行だけボタン直下にパスワードが表示される', () => {
    const rows: OpenChatFlexRow[] = [
      makeRow({ label: 'B級', url: 'https://line.me/ti/g2/tokenB', password: null }),
      makeRow({ label: 'C級', url: 'https://line.me/ti/g2/tokenC', password: 'azuma26' }),
      makeRow({ label: 'D級', url: 'https://line.me/ti/g2/tokenD', password: null }),
    ]
    const msg = buildOpenChatFlexMessage(rows, '東京東会大会BCD級')
    const pwTexts = collectByType(msg.contents, 'text').filter(
      (t) => typeof t.text === 'string' && (t.text as string).startsWith('パスワード'),
    )
    expect(pwTexts.map((t) => t.text)).toEqual(['パスワード: azuma26'])
    expect(pwTexts.map((t) => t.color)).toEqual(['#6E7B8A'])
  })

  it('AC-32: パスワードの無い行 (null・空文字) にはパスワード表示が出ない', () => {
    const rows: OpenChatFlexRow[] = [
      makeRow({ password: null }),
      makeRow({ label: '別の行', url: 'https://line.me/ti/g2/tokenY', password: '' }),
    ]
    const msg = buildOpenChatFlexMessage(rows, '鳳玉大会CD級')
    const pwTexts = collectByType(msg.contents, 'text').filter(
      (t) => typeof t.text === 'string' && (t.text as string).startsWith('パスワード'),
    )
    expect(pwTexts).toHaveLength(0)
  })

  it('AC-33: 各ボタンは uri アクションで、URL はボタンの action 以外に現れない', () => {
    const rows: OpenChatFlexRow[] = [
      makeRow({ label: 'B級', url: 'https://line.me/ti/g2/tokenB', password: null }),
      makeRow({ label: 'C級', url: 'https://line.me/ti/g2/tokenC', password: 'pw123' }),
    ]
    const msg = buildOpenChatFlexMessage(rows, '東京東会大会BCD級')
    const buttons = collectByType(msg.contents, 'button')
    expect(buttons).toHaveLength(2)
    const actions = buttons.map((btn) => btn.action as Record<string, unknown>)
    expect(actions.map((a) => a.type)).toEqual(rows.map(() => 'uri'))
    expect(actions.map((a) => a.uri)).toEqual(rows.map((r) => r.url))
    expect(actions.map((a) => a.label)).toEqual(rows.map((r) => r.label))

    const json = JSON.stringify(msg.contents)
    for (const r of rows) {
      // action.uri 以外 (テキスト要素等) に URL が現れなければ、JSON 全体を
      // 文字列化したときその URL の出現回数はちょうど1回 (split すると2要素)。
      expect(json.split(r.url)).toHaveLength(2)
    }
  })

  it('AC-34: altText は「オープンチャットのご案内／<大会名>」になる', () => {
    const msg = buildOpenChatFlexMessage([makeRow()], '鳳玉大会CD級')
    expect(msg.altText).toBe('オープンチャットのご案内／鳳玉大会CD級')
  })

  it('AC-34: 400字を超える大会名は切り詰められる', () => {
    const longName = 'あ'.repeat(500)
    const msg = buildOpenChatFlexMessage([makeRow()], longName)
    expect(msg.altText.length).toBe(400)
    expect(msg.altText.startsWith('オープンチャットのご案内／あ')).toBe(true)
  })

  it('AC-34: 切り詰め位置がサロゲートペアに当たっても分断しない', () => {
    // 'オープンチャットのご案内／' は 13 UTF-16 単位 (全て BMP)。以降を 2 単位の
    // 𠮟 で埋めると 400 単位目はペアの前半に当たる。素の slice だと単独サロゲート
    // が末尾に残るが、コードポイント境界で止めるため 1 単位手前 (399) で切れる。
    const longName = '𠮟'.repeat(300)
    const msg = buildOpenChatFlexMessage([makeRow()], longName)
    expect(msg.altText.length).toBe(399)
    expect(msg.altText.startsWith('オープンチャットのご案内／𠮟')).toBe(true)
    expect(msg.altText.endsWith('𠮟')).toBe(true)
    const lone = [...msg.altText].filter((ch) => {
      const cp = ch.codePointAt(0)!
      return ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff
    })
    expect(lone).toEqual([])
  })

  it('AC-50: バブル内テキストはボタンラベル・パスワード行を除き「大会オープンチャット」と大会名の2つだけ', () => {
    const rows: OpenChatFlexRow[] = [
      makeRow({ label: 'B級', url: 'https://line.me/ti/g2/tokenB', password: null }),
      makeRow({ label: 'C級', url: 'https://line.me/ti/g2/tokenC', password: 'azuma26' }),
      makeRow({ label: 'D級', url: 'https://line.me/ti/g2/tokenD', password: null }),
    ]
    const msg = buildOpenChatFlexMessage(rows, '東京東会大会BCD級')
    const texts = collectByType(msg.contents, 'text').filter(
      (t) => typeof t.text === 'string' && !(t.text as string).startsWith('パスワード'),
    )
    expect(texts.map((t) => t.text)).toEqual(['大会オープンチャット', '東京東会大会BCD級'])
  })

  it('渡した行の順序がそのままボタン順になる (この関数内で並べ替えない・AC-52 の契約)', () => {
    const rows: OpenChatFlexRow[] = [
      makeRow({ label: '3年の部', url: 'https://line.me/ti/g2/tokenX3' }),
      makeRow({ label: '1年の部', url: 'https://line.me/ti/g2/tokenX1' }),
      makeRow({ label: '2年の部', url: 'https://line.me/ti/g2/tokenX2' }),
    ]
    const msg = buildOpenChatFlexMessage(rows, '中学生選手権')
    const buttons = collectByType(msg.contents, 'button')
    expect(buttons.map((b) => (b.action as Record<string, unknown>).label)).toEqual([
      '3年の部',
      '1年の部',
      '2年の部',
    ])
  })
})
