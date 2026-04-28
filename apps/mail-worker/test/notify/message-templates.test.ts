import { describe, expect, it } from 'vitest'
import {
  buildErrorMessage,
  buildNewDraftsMessage,
} from '../../src/notify/message-templates.js'

describe('buildNewDraftsMessage', () => {
  it('throws on empty input (caller is expected to gate on N >= 1)', () => {
    expect(() => buildNewDraftsMessage({ drafts: [] })).toThrow(
      /requires at least one draft/,
    )
  })

  it('renders a single draft without an overflow line', () => {
    const out = buildNewDraftsMessage({
      drafts: [{ subject: '第65回全日本選手権大会' }],
    })
    expect(out).toBe(
      [
        '📬 新規大会案内 1 件を取り込みました',
        '・第65回全日本選手権大会',
        '→ /admin/mail-inbox',
      ].join('\n'),
    )
  })

  it('renders exactly 5 drafts with all subjects, no overflow line', () => {
    const drafts = [1, 2, 3, 4, 5].map((n) => ({ subject: `大会${n}` }))
    const out = buildNewDraftsMessage({ drafts })
    const lines = out.split('\n')
    expect(lines).toEqual([
      '📬 新規大会案内 5 件を取り込みました',
      '・大会1',
      '・大会2',
      '・大会3',
      '・大会4',
      '・大会5',
      '→ /admin/mail-inbox',
    ])
  })

  it('truncates to top 5 and appends 他 N 件 when over limit (6 drafts → 1 件)', () => {
    const drafts = [1, 2, 3, 4, 5, 6].map((n) => ({ subject: `大会${n}` }))
    const out = buildNewDraftsMessage({ drafts })
    const lines = out.split('\n')
    expect(lines).toEqual([
      '📬 新規大会案内 6 件を取り込みました',
      '・大会1',
      '・大会2',
      '・大会3',
      '・大会4',
      '・大会5',
      '他 1 件',
      '→ /admin/mail-inbox',
    ])
  })

  it('overflow line shows total - 5 (10 drafts → 他 5 件)', () => {
    const drafts = Array.from({ length: 10 }, (_, i) => ({
      subject: `大会${i + 1}`,
    }))
    const out = buildNewDraftsMessage({ drafts })
    expect(out).toContain('📬 新規大会案内 10 件を取り込みました')
    expect(out).toContain('他 5 件')
    // Sanity: only the first 5 subjects show up explicitly
    expect(out).toContain('・大会5')
    expect(out).not.toContain('・大会6')
    expect(out.endsWith('→ /admin/mail-inbox')).toBe(true)
  })
})

describe('buildErrorMessage', () => {
  it("kind='imap' uses the IMAP headline", () => {
    const out = buildErrorMessage({
      kind: 'imap',
      recentRuns: 3,
      lastError: 'IMAP socket closed',
    })
    expect(out).toContain('⚠️ メール取り込みが連続 3 回 IMAP エラーで失敗しています')
    expect(out).toContain('IMAP socket closed')
    expect(out.endsWith('→ /admin/mail-inbox')).toBe(true)
  })

  it("kind='ai' uses the AI headline", () => {
    const out = buildErrorMessage({
      kind: 'ai',
      recentRuns: 4,
      lastError: 'Anthropic 500',
    })
    expect(out).toContain('⚠️ AI 抽出が連続 4 件失敗しています')
    expect(out).toContain('Anthropic 500')
  })

  it('lastError of exactly 199 chars is preserved verbatim (no ellipsis)', () => {
    const detail = 'a'.repeat(199)
    const out = buildErrorMessage({
      kind: 'imap',
      recentRuns: 3,
      lastError: detail,
    })
    expect(out).toContain(detail)
    expect(out).not.toContain('…')
  })

  it('lastError of exactly 200 chars is preserved verbatim (boundary)', () => {
    const detail = 'a'.repeat(200)
    const out = buildErrorMessage({
      kind: 'imap',
      recentRuns: 3,
      lastError: detail,
    })
    expect(out).toContain(detail)
    expect(out).not.toContain('…')
  })

  it('lastError of 201 chars is truncated to 200 + …', () => {
    const detail = 'a'.repeat(201)
    const out = buildErrorMessage({
      kind: 'imap',
      recentRuns: 3,
      lastError: detail,
    })
    // The kept body is the first 200 chars; the appended ellipsis signals
    // truncation. Original 201st char must NOT survive.
    expect(out).toContain('a'.repeat(200) + '…')
    expect(out).not.toContain('a'.repeat(201))
  })

  it('truncation counts Unicode code points, not UTF-16 units (surrogate-safe)', () => {
    // 200 emoji (each is a surrogate pair, .length === 2 in UTF-16). Naive
    // string.length truncation at 200 would mid-cut the 100th emoji.
    const detail = '🍣'.repeat(201)
    const out = buildErrorMessage({
      kind: 'imap',
      recentRuns: 3,
      lastError: detail,
    })
    // Whole emoji are kept (200 of them) and nothing is cut in half.
    expect(out).toContain('🍣'.repeat(200) + '…')
    // No lone surrogate (would render as U+FFFD); using a code-point check
    // via Array.from is the simplest assertion.
    const detailLines = out.split('\n')
    const emojiLine = detailLines.find((l) => l.startsWith('🍣')) ?? ''
    // 200 code points + 1 ellipsis code point.
    expect(Array.from(emojiLine).length).toBe(201)
  })
})
