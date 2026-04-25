import { describe, it, expect } from 'vitest'
import { shouldSkipByHeaders } from '../../src/fetch/pre-filter.js'

describe('shouldSkipByHeaders', () => {
  it('returns false for a vanilla mail with no special headers', () => {
    expect(
      shouldSkipByHeaders({
        from: 'someone@example.com',
        subject: 'hello',
      }),
    ).toBe(false)
  })

  it('skips when List-Unsubscribe is present and List-Id is missing (consumer newsletter signal)', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '<mailto:unsubscribe@example.com>',
        from: 'announcer@example.org',
      }),
    ).toBe(true)
  })

  it('skips when List-Unsubscribe + no List-Id, even with a regular From address', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '<mailto:u@x.com>, <https://x.com/unsub>',
        from: 'marketing@example.com',
      }),
    ).toBe(true)
  })

  it('skips when List-Unsubscribe + no List-Id + no-reply From (still noise)', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '<https://x.com/unsub>',
        from: 'noreply@example.com',
      }),
    ).toBe(true)
  })

  it('does NOT skip when List-Unsubscribe + List-Id are both present, even with no-reply From (legitimate ML)', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '<mailto:u@x.com>',
        'list-id': '<announcements.example.org>',
        from: 'no-reply@example.org',
      }),
    ).toBe(false)
  })

  it('does NOT skip when List-Unsubscribe is empty whitespace', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '   ',
        from: 'no-reply@example.com',
      }),
    ).toBe(false)
  })

  it('skips Auto-Submitted: auto-generated', () => {
    expect(
      shouldSkipByHeaders({ 'auto-submitted': 'auto-generated' }),
    ).toBe(true)
  })

  it('skips Auto-Submitted: auto-replied', () => {
    expect(
      shouldSkipByHeaders({ 'auto-submitted': 'auto-replied' }),
    ).toBe(true)
  })

  it('does NOT skip Auto-Submitted: no', () => {
    expect(shouldSkipByHeaders({ 'auto-submitted': 'no' })).toBe(false)
  })

  it('skips Precedence: bulk', () => {
    expect(shouldSkipByHeaders({ precedence: 'bulk' })).toBe(true)
  })

  it('skips Precedence: junk', () => {
    expect(shouldSkipByHeaders({ precedence: 'junk' })).toBe(true)
  })

  it('does NOT skip Precedence: list (legitimate ML header, e.g. taikai-ajka)', () => {
    expect(shouldSkipByHeaders({ precedence: 'list' })).toBe(false)
  })

  it('does NOT skip Precedence: first-class', () => {
    expect(shouldSkipByHeaders({ precedence: 'first-class' })).toBe(false)
  })

  it('skips X-Spam-Flag: YES (case-insensitive)', () => {
    expect(shouldSkipByHeaders({ 'x-spam-flag': 'YES' })).toBe(true)
    expect(shouldSkipByHeaders({ 'x-spam-flag': 'yes' })).toBe(true)
  })

  it('does NOT skip X-Spam-Flag: NO', () => {
    expect(shouldSkipByHeaders({ 'x-spam-flag': 'NO' })).toBe(false)
  })

  it('skips X-Spam-Status starting with Yes', () => {
    expect(
      shouldSkipByHeaders({
        'x-spam-status': 'Yes, score=8.5 required=5.0',
      }),
    ).toBe(true)
  })

  it('does NOT skip X-Spam-Status starting with No', () => {
    expect(
      shouldSkipByHeaders({
        'x-spam-status': 'No, score=0.1 required=5.0',
      }),
    ).toBe(false)
  })

  it('does NOT skip a realistic ML announcement mail (List-Id + Precedence: list + List-Unsubscribe)', () => {
    expect(
      shouldSkipByHeaders({
        'list-id': '<taikai-ajka.karuta.or.jp>',
        'list-unsubscribe': '<mailto:taikai-ajka-unsubscribe@karuta.or.jp>',
        precedence: 'list',
        sender: 'kyoukai@karuta.or.jp',
        from: 'kyoukai@karuta.or.jp',
      }),
    ).toBe(false)
  })

  it('skips a realistic consumer newsletter (Precedence: bulk + no-reply From + List-Unsubscribe)', () => {
    expect(
      shouldSkipByHeaders({
        'list-unsubscribe': '<https://newsletter.example.com/unsub>',
        precedence: 'bulk',
        from: 'no-reply@newsletter.example.com',
      }),
    ).toBe(true)
  })

  it('combines multiple checks (any one match wins — Precedence: bulk dominates)', () => {
    expect(
      shouldSkipByHeaders({
        precedence: 'bulk',
        from: 'team@example.com',
      }),
    ).toBe(true)
  })

  it('treats header keys case-sensitively at lookup level (caller must lowercase)', () => {
    // This test documents the contract: imap-client.ts already lowercases
    // headers, so this lookup variant returns false (we do not see the key).
    expect(
      shouldSkipByHeaders({
        Precedence: 'bulk',
      }),
    ).toBe(false)
  })
})
