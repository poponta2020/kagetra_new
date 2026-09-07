import { describe, expect, it } from 'vitest'
import { buildMailBodyFlexMessage } from './line-flex-mail-body'

describe('buildMailBodyFlexMessage', () => {
  const url = 'https://example.com/mail-share/tok123'

  it('AC-3: ✉ バッジ + 件名 + サブタイトルで、URL は uri アクションにだけ載る', () => {
    const msg = buildMailBodyFlexMessage({
      subject: '第33回◯◯大会について',
      url,
      isCorrection: false,
    })
    expect(msg.type).toBe('flex')

    const json = JSON.stringify(msg.contents)
    expect(json).toContain('"uri":"https://example.com/mail-share/tok123"')
    // ブランド色（globals.css の --kg-brand 藤）の 48px バッジに白の ✉。
    expect(json).toContain('"backgroundColor":"#534286"')
    expect(json).toContain('"width":"48px"')
    expect(json).toContain('"text":"✉"')
    expect(json).toContain('"text":"第33回◯◯大会について"')
    expect(json).toContain('"text":"タップして全文を見る"')
    // カード body 全体がタップ領域。
    const body = (msg.contents as { body: Record<string, unknown> }).body
    expect(body.action).toEqual({ type: 'uri', label: '全文を見る', uri: url })
    // URL がテキストコンポーネントとして露出していない (uri プロパティのみ)。
    expect(json.split(url)).toHaveLength(2)
  })

  it('AC-3: 長い件名は 3 行で打ち切る（カードが縦に伸びない）', () => {
    const msg = buildMailBodyFlexMessage({
      subject: 'あ'.repeat(200),
      url,
      isCorrection: false,
    })
    expect(JSON.stringify(msg.contents)).toContain('"maxLines":3')
  })

  it('AC-2: altText は 📧 件名', () => {
    const msg = buildMailBodyFlexMessage({
      subject: '第33回◯◯大会について',
      url,
      isCorrection: false,
    })
    expect(msg.altText).toBe('📧 第33回◯◯大会について')
  })

  it('AC-4: 件名が空・NULL・空白のみなら (件名なし)', () => {
    for (const subject of [null, undefined, '', '   ']) {
      const msg = buildMailBodyFlexMessage({ subject, url, isCorrection: false })
      expect(msg.altText).toBe('📧 (件名なし)')
      expect(JSON.stringify(msg.contents)).toContain('"text":"(件名なし)"')
    }
  })

  it('AC-5: 訂正版はカード見出しと altText の件名先頭に【訂正】が付く', () => {
    const msg = buildMailBodyFlexMessage({
      subject: '第33回◯◯大会について',
      url,
      isCorrection: true,
    })
    expect(msg.altText).toBe('📧 【訂正】第33回◯◯大会について')
    expect(JSON.stringify(msg.contents)).toContain(
      '"text":"【訂正】第33回◯◯大会について"',
    )
  })

  it('AC-5: 件名なしの訂正版は【訂正】(件名なし)', () => {
    const msg = buildMailBodyFlexMessage({ subject: null, url, isCorrection: true })
    expect(msg.altText).toBe('📧 【訂正】(件名なし)')
  })

  it('AC-2: altText は LINE 上限の 400 字に切り詰める', () => {
    const msg = buildMailBodyFlexMessage({
      subject: 'あ'.repeat(500),
      url,
      isCorrection: false,
    })
    expect(msg.altText.length).toBe(400)
    expect(msg.altText.startsWith('📧 あ')).toBe(true)
  })

  it('AC-2: 切り詰め位置がサロゲートペアに当たっても分断しない', () => {
    // '📧 ' が 3 UTF-16 単位。以降を 2 単位の 𠮟 で埋めると 400 単位目が
    // ペアの前半に当たる。素の slice だと単独サロゲートが末尾に残る。
    const msg = buildMailBodyFlexMessage({
      subject: '𠮟'.repeat(300),
      url,
      isCorrection: false,
    })
    // 境界を割らないぶん 1 単位手前で止まる。
    expect(msg.altText.length).toBe(399)
    const lone = [...msg.altText].filter((ch) => {
      const cp = ch.codePointAt(0)!
      return ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff
    })
    expect(lone).toHaveLength(0)
  })
})
