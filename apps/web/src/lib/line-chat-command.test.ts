import { describe, it, expect } from 'vitest'
import { parseChatCommand } from './line-chat-command'
import type { LineMessageMention } from './line-chat-command'

const BOT_USER_ID = 'Ubot0000000000000000000000000000'

/** `@Bot ` を先頭に付けた自己メンション付きテキストを組み立てる（語判定用の共通フィクスチャ）。 */
function withSelfMention(body: string): { text: string; mention: LineMessageMention } {
  const prefix = '@Bot '
  return {
    text: `${prefix}${body}`,
    mention: { mentionees: [{ index: 0, length: prefix.length, isSelf: true }] },
  }
}

describe('parseChatCommand', () => {
  describe('申込語（要件 §3.2.2 に列挙された全表記ゆれ）', () => {
    const entryWords = ['申込', '申し込み', '申込完了', '申込済', '申し込みました', '申し込んだ']

    it.each(entryWords)('「%s」で entry: true になる', (word) => {
      const { text, mention } = withSelfMention(`大会に${word}`)
      const result = parseChatCommand({ text, mention, botUserId: BOT_USER_ID })
      expect(result.entry).toBe(true)
    })
  })

  describe('支払語（要件 §3.2.2 に列挙された全表記ゆれ）', () => {
    const paymentWords = [
      '振込',
      '振り込み',
      '振込完了',
      '振り込みました',
      '入金しました',
      '支払いました',
      '払いました',
    ]

    it.each(paymentWords)('「%s」で payment: true になる', (word) => {
      const { text, mention } = withSelfMention(`参加費を${word}`)
      const result = parseChatCommand({ text, mention, botUserId: BOT_USER_ID })
      expect(result.payment).toBe(true)
    })
  })

  describe('否定表現（要件 §3.2.4）', () => {
    it.each(['まだ申し込んでません', '振り込んでいない', '未入金'])(
      '「%s」で negated: true になる',
      (body) => {
        const { text, mention } = withSelfMention(body)
        const result = parseChatCommand({ text, mention, botUserId: BOT_USER_ID })
        expect(result.negated).toBe(true)
      },
    )

    // 誤検出防止: 「た」「ました」等の肯定完了表現は否定語リストと重ならないことを固定する
    it.each(['申し込みました', '入金しました', '支払いました'])(
      '「%s」は negated: false になる（誤検出防止）',
      (body) => {
        const { text, mention } = withSelfMention(body)
        const result = parseChatCommand({ text, mention, botUserId: BOT_USER_ID })
        expect(result.negated).toBe(false)
      },
    )
  })

  it('申込語と支払語の両方を含む発言では entry: true かつ payment: true になる（AC-9）', () => {
    const { text, mention } = withSelfMention('申し込んで振り込みました')
    const result = parseChatCommand({ text, mention, botUserId: BOT_USER_ID })
    expect(result.entry).toBe(true)
    expect(result.payment).toBe(true)
  })

  it('mention が null のとき、語を含んでいても mentionsBot: false（AC-10）で他フィールドも false 固定になる', () => {
    const result = parseChatCommand({
      text: '大会に申込して振り込みました',
      mention: null,
      botUserId: BOT_USER_ID,
    })
    expect(result).toEqual({
      mentionsBot: false,
      entry: false,
      payment: false,
      negated: false,
    })
  })

  it('mention が undefined のときも同様に mentionsBot: false になる', () => {
    const result = parseChatCommand({
      text: '申込します',
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(false)
  })

  it('isSelf が無くても mentionee.userId が botUserId と一致すれば mentionsBot: true になる', () => {
    const prefix = '@管理Bot'
    const text = `${prefix} 申込`
    const result = parseChatCommand({
      text,
      mention: {
        mentionees: [{ index: 0, length: prefix.length, userId: BOT_USER_ID }],
      },
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(true)
  })

  it('他人へのメンションだけ（isSelf 無し・userId が別値）では mentionsBot: false（AC-10）', () => {
    const prefix = '@田中'
    const text = `${prefix} 申込`
    const result = parseChatCommand({
      text,
      mention: {
        mentionees: [{ index: 0, length: prefix.length, userId: 'Uother00000000000000000000000000' }],
      },
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(false)
  })

  it('★Bot の表示名自体に対象語を含む場合、メンション文字列を除去してから判定するので entry: false になる', () => {
    const text = '@申込Bot こんにちは'
    const result = parseChatCommand({
      text,
      mention: { mentionees: [{ index: 0, length: 7, isSelf: true }] },
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(true)
    expect(result.entry).toBe(false)
  })

  it('★他人へのメンション range も除去される: 表示名に「振込」を含む他人メンションがあっても payment: false になる', () => {
    // 「@Bot 」(自己メンション, isSelf) + 「@振込太郎」(他人メンション, 表示名に振込を含む) + 挨拶のみの本文
    const selfMentionText = '@Bot '
    const otherMentionText = '@振込太郎'
    const text = `${selfMentionText}${otherMentionText} こんにちは`
    const result = parseChatCommand({
      text,
      mention: {
        mentionees: [
          { index: 0, length: selfMentionText.length, isSelf: true },
          {
            index: selfMentionText.length,
            length: otherMentionText.length,
            userId: 'Uother00000000000000000000000000',
          },
        ],
      },
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(true)
    expect(result.payment).toBe(false)
  })

  it('★降順削除の検証: 後方のメンション（表示名に「申込」を含む）を先に前方の index のまま削除すると index がずれて誤判定になる配置', () => {
    // 構成: 「@Bot」(自己メンション, index 0) + 「こんにちは」(語を含まない地の文) +
    //       「@申込太郎」(他人メンション, 表示名に申込を含む, index は自己メンションより後方)
    // 前方（index 昇順）から削除して以降の index を再調整しない実装だと、後方メンションの
    // 削除位置が「削除済み文字数だけ後ろにずれた」誤った範囲を切り取ってしまい、
    // 本来除去されるべき「申込太郎」の "申込" 部分が本文に残ってしまう。
    // 正しい実装（index 降順で後ろから削除、または削除前に全 range を確定してから処理する
    // 実装）ではこの「申込」は確実に除去され、entry: false になる。
    const selfMentionText = '@Bot'
    const freeText = 'こんにちは'
    const otherMentionText = '@申込太郎'
    const text = `${selfMentionText}${freeText}${otherMentionText}`
    const result = parseChatCommand({
      text,
      mention: {
        mentionees: [
          { index: 0, length: selfMentionText.length, isSelf: true },
          {
            index: selfMentionText.length + freeText.length,
            length: otherMentionText.length,
            userId: 'Uother00000000000000000000000000',
          },
        ],
      },
      botUserId: BOT_USER_ID,
    })
    expect(result.mentionsBot).toBe(true)
    expect(result.entry).toBe(false)
  })

  it('index / length が範囲外・負値でも throw せず安全に処理する', () => {
    const text = '@Bot 申込'
    const call = () =>
      parseChatCommand({
        text,
        mention: {
          mentionees: [
            { index: -5, length: 4, isSelf: true },
            { index: 1000, length: 50 },
          ],
        },
        botUserId: BOT_USER_ID,
      })
    expect(call).not.toThrow()
    expect(call().mentionsBot).toBe(true)
  })
})
