import { describe, expect, it } from 'vitest'
import { bytesFromBytea } from '../../src/classify/classifier.js'

/**
 * Regression coverage for the PDF base64 bug discovered 2026-05-11.
 *
 * Background: drizzle-orm/node-postgres returns bytea differently depending on
 * the query shape. A direct `findFirst()` returns a real `Buffer`, but a
 * nested `findFirst({ with: { attachments: { columns: { data: true } } } })`
 * returns the raw postgres hex-escape string (`"\\x<hex>"`). Calling
 * `Buffer.from(string)` on that re-interprets the `\x...` characters as
 * UTF-8 and corrupts the bytes, causing Anthropic to reject the PDF with
 * `400 invalid_request_error: ... The PDF specified was not valid` for
 * roughly 60% of attachments in the wild (worklog 2026-05-09 Phase 2 prove).
 */
describe('bytesFromBytea', () => {
  it('returns the same Buffer instance when input is already a Buffer', () => {
    const input = Buffer.from([0x25, 0x50, 0x44, 0x46])
    const out = bytesFromBytea(input)
    expect(out).toBe(input)
  })

  it('hex-decodes a postgres `\\x<hex>` escape string into the right bytes', () => {
    // "\x25504446" should decode to "%PDF" (the PDF magic).
    const out = bytesFromBytea('\\x25504446')
    expect(out.toString('hex')).toBe('25504446')
    expect(out.equals(Buffer.from('%PDF', 'utf8'))).toBe(true)
  })

  it('round-trips bytes → hex-escape → bytes losslessly so base64 stays canonical', () => {
    // Models exactly what classifier.ts:108 hits in production: drizzle hands
    // us the hex-escape; we must reach the same base64 as if we had the raw
    // Buffer in hand. Anything else and Anthropic rejects the document.
    const pdfHeader = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, // "%PDF-1.7"
      0x0d, 0x0a, 0x25, 0xb5, 0xb5, 0xb5, 0xb5, 0x0d, // binary signature line
    ])
    const hexEscape = '\\x' + pdfHeader.toString('hex')
    const out = bytesFromBytea(hexEscape)
    expect(out.equals(pdfHeader)).toBe(true)
    expect(out.toString('base64')).toBe(pdfHeader.toString('base64'))
  })

  it('falls back to Buffer.from for other input shapes (Uint8Array)', () => {
    // Drizzle versions that hand bytea through as Uint8Array (no Buffer wrap)
    // must still produce the right bytes — the helper covers this path
    // defensively so it stays correct across driver upgrades.
    const u8 = new Uint8Array([1, 2, 3, 4])
    const out = bytesFromBytea(u8)
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out.equals(Buffer.from(u8))).toBe(true)
  })
})
