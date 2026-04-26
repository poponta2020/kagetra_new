import { describe, expect, it } from 'vitest'
import { extractXlsxText } from '../../src/extract/xlsx.js'
import { buildMinimalXlsx } from '../fixtures/attachments/builders.js'

describe('extractXlsxText', () => {
  it('extracts each sheet as `=== <name> ===` followed by CSV rows', async () => {
    const buffer = buildMinimalXlsx('Schedule', [
      ['Date', 'Round'],
      ['2026-05-30', 'A'],
      ['2026-05-31', 'B'],
    ])
    const text = await extractXlsxText(buffer)
    expect(text).toContain('=== Schedule ===')
    expect(text).toContain('Date,Round')
    expect(text).toContain('2026-05-30,A')
    expect(text).toContain('2026-05-31,B')
  })

  it('rejects a truncated zip header — orchestrator catches this and marks failed', async () => {
    // SheetJS is intentionally permissive (it interprets bare text as CSV),
    // so to exercise the failure path we hand it a buffer that looks like a
    // truncated ZIP (XLSX is ZIP-based) which `XLSX.read` cannot recover.
    const truncatedZip = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, // PK\x03\x04 local file header magic
      0xff, 0xff, 0xff, 0xff, // bogus version/flags so the parser bails
    ])
    await expect(extractXlsxText(truncatedZip)).rejects.toThrow()
  })
})
