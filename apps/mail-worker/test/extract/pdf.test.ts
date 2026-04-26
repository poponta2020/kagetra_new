import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../../src/extract/pdf.js'
import { buildCorruptPdf, buildMinimalPdf } from '../fixtures/attachments/builders.js'

describe('extractPdfText', () => {
  it('extracts the visible text from a single-page PDF', async () => {
    const buffer = buildMinimalPdf('PR2 fixture text')
    const text = await extractPdfText(buffer)
    expect(text).toContain('PR2 fixture text')
  })

  it('throws on a corrupt PDF — orchestrator catches this and marks failed', async () => {
    const buffer = buildCorruptPdf()
    await expect(extractPdfText(buffer)).rejects.toThrow()
  })
})
