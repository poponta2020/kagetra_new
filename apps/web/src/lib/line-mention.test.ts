import { describe, it, expect } from 'vitest'
import { buildMentionMessage, buildTextMessage } from './line-mention'
import type { LineTextV2Message } from './line-mention'

/** 本文から `{m0}` のようなプレースホルダ名を抽出する。 */
function extractPlaceholderNames(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

describe('buildMentionMessage', () => {
  it('builds a textV2 message with mentionee.type=all (AC-7)', () => {
    const result = buildMentionMessage({
      mention: { kind: 'all' },
      label: '@All',
      template: '大会の申し込み締め切りです',
    })
    expect(result.type).toBe('textV2')
    const v2 = result as LineTextV2Message
    expect(v2.text).toBe('{m0}\n大会の申し込み締め切りです')
    expect(v2.substitution).toEqual({
      m0: { type: 'mention', mentionee: { type: 'all' } },
    })
  })

  it('mentions multiple users with one substitution per userId, in order', () => {
    const result = buildMentionMessage({
      mention: { kind: 'users', userIds: ['u1', 'u2', 'u3'] },
      label: '@会計',
      template: '振込連絡です',
    })
    expect(result.type).toBe('textV2')
    const v2 = result as LineTextV2Message
    expect(v2.text).toBe('{m0} {m1} {m2}\n振込連絡です')
    expect(v2.substitution).toEqual({
      m0: { type: 'mention', mentionee: { type: 'user', userId: 'u1' } },
      m1: { type: 'mention', mentionee: { type: 'user', userId: 'u2' } },
      m2: { type: 'mention', mentionee: { type: 'user', userId: 'u3' } },
    })
  })

  it('keeps placeholder names in the body consistent with substitution keys', () => {
    const result = buildMentionMessage({
      mention: { kind: 'users', userIds: ['u1', 'u2', 'u3', 'u4'] },
      label: '@管理者',
      template: '確認してください',
    })
    const v2 = result as LineTextV2Message
    const placeholderNames = new Set(extractPlaceholderNames(v2.text))
    expect(placeholderNames).toEqual(new Set(Object.keys(v2.substitution)))
  })

  it('returns a plain text message with the label as the first line when userIds is empty (AC-5)', () => {
    const result = buildMentionMessage({
      mention: { kind: 'users', userIds: [] },
      label: '@会計',
      template: '振込連絡です',
    })
    expect(result).toEqual({ type: 'text', text: '@会計\n振込連絡です' })
  })

  it('omits the newline when body is empty and userIds is empty', () => {
    const result = buildMentionMessage({
      mention: { kind: 'users', userIds: [] },
      label: '@会計',
      template: '',
    })
    expect(result).toEqual({ type: 'text', text: '@会計' })
  })

  it('throws when template contains a brace (AC-8)', () => {
    expect(() =>
      buildMentionMessage({
        mention: { kind: 'all' },
        label: '@All',
        template: '大会{名}の締め切りです',
      }),
    ).toThrow()
  })

  it('throws when label contains a brace (AC-8)', () => {
    expect(() =>
      buildMentionMessage({
        mention: { kind: 'all' },
        label: '@{All}',
        template: '締め切りです',
      }),
    ).toThrow()
  })

  it('throws when the number of %s placeholders and values differ', () => {
    expect(() =>
      buildMentionMessage({
        mention: { kind: 'all' },
        label: '@All',
        template: '対象は%s人・%s円です',
        values: [3],
      }),
    ).toThrow()
  })

  it('substitutes number values without thousands separators', () => {
    const result = buildMentionMessage({
      mention: { kind: 'all' },
      label: '@All',
      template: '対象は%s人・合計%s円です',
      values: [3, 7500],
    })
    const v2 = result as LineTextV2Message
    expect(v2.text).toBe('{m0}\n対象は3人・合計7500円です')
  })

  it('substitutes a { dateIso } value via formatEventDate', () => {
    // 2026-07-25 is a Saturday.
    const result = buildMentionMessage({
      mention: { kind: 'all' },
      label: '@All',
      template: '締め切りは%sです',
      values: [{ dateIso: '2026-07-25' }],
    })
    const v2 = result as LineTextV2Message
    expect(v2.text).toBe('{m0}\n締め切りは7/25(土)です')
  })

  it('caps substitutions at 100 when userIds exceeds 100', () => {
    const userIds = Array.from({ length: 101 }, (_, i) => `u${i}`)
    const result = buildMentionMessage({
      mention: { kind: 'users', userIds },
      label: '@会計',
      template: '振込連絡です',
    })
    const v2 = result as LineTextV2Message
    expect(Object.keys(v2.substitution)).toHaveLength(100)
    expect(v2.substitution.m99).toEqual({
      type: 'mention',
      mentionee: { type: 'user', userId: 'u99' },
    })
    expect(v2.substitution.m100).toBeUndefined()
  })
})

describe('buildTextMessage', () => {
  it('returns a plain text message', () => {
    expect(buildTextMessage('振込先口座はこちらです')).toEqual({
      type: 'text',
      text: '振込先口座はこちらです',
    })
  })
})
