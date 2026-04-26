import { describe, expect, it } from 'vitest'
import { extractAttachment } from '../../src/extract/orchestrator.js'
import {
  buildCorruptPdf,
  buildMinimalDocx,
  buildMinimalPdf,
  buildMinimalXlsx,
} from '../fixtures/attachments/builders.js'

describe('extractAttachment (orchestrator)', () => {
  it('routes application/pdf to the PDF extractor and returns extracted', async () => {
    const data = buildMinimalPdf('Hello PDF')
    const result = await extractAttachment({
      contentType: 'application/pdf',
      filename: 'guide.pdf',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toContain('Hello PDF')
  })

  it('routes the DOCX OpenXML content type to the DOCX extractor', async () => {
    const data = await buildMinimalDocx('Hello DOCX')
    const result = await extractAttachment({
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'guide.docx',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toBe('Hello DOCX')
  })

  it('treats XLSX OpenXML attachments as unsupported (PR2: extractor disabled)', async () => {
    // PR2 dropped the XLSX text extractor because the only viable JS parser
    // (`xlsx@0.18.5`) carries unpatched high-severity vulnerabilities. The
    // binary still persists upstream; we just refuse to parse it.
    const data = buildMinimalXlsx('S1', [['a', 'b']])
    const result = await extractAttachment({
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'roster.xlsx',
      data,
    })
    expect(result.status).toBe('unsupported')
    expect(result.text).toBeNull()
  })

  it('treats octet-stream + .xlsx filename as unsupported', async () => {
    // Suffix-tiebreaker must NOT route XLSX through any extractor.
    const result = await extractAttachment({
      contentType: 'application/octet-stream',
      filename: 'roster.xlsx',
      data: buildMinimalXlsx('S', [['a']]),
    })
    expect(result.status).toBe('unsupported')
    expect(result.text).toBeNull()
  })

  it('falls back to filename suffix for application/octet-stream', async () => {
    const data = buildMinimalPdf('via octet-stream')
    const result = await extractAttachment({
      contentType: 'application/octet-stream',
      filename: 'guide.pdf',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toContain('via octet-stream')
  })

  it('does NOT override a known non-text content type by filename', async () => {
    // image/png with a .pdf filename should stay unsupported — trusting
    // the suffix here would mis-route legitimately typed binaries.
    const result = await extractAttachment({
      contentType: 'image/png',
      filename: 'fake.pdf',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })
    expect(result.status).toBe('unsupported')
    expect(result.text).toBeNull()
  })

  it('returns unsupported for unknown types with no recognizable suffix', async () => {
    const result = await extractAttachment({
      contentType: 'application/zip',
      filename: 'bundle.zip',
      data: Buffer.from('PK'),
    })
    expect(result.status).toBe('unsupported')
    expect(result.text).toBeNull()
  })

  it('returns failed (not throw) when the extractor throws', async () => {
    const result = await extractAttachment({
      contentType: 'application/pdf',
      filename: 'broken.pdf',
      data: buildCorruptPdf(),
    })
    expect(result.status).toBe('failed')
    expect(result.text).toBeNull()
    expect(result.reason).toBeTypeOf('string')
  })
})
