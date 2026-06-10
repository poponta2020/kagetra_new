import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractAttachment } from '../../src/extract/orchestrator.js'
import {
  buildCorruptPdf,
  buildMinimalDocx,
  buildMinimalPdf,
  buildMinimalXlsx,
} from '../fixtures/attachments/builders.js'

// Committed binary fixture — see the provenance note in doc.test.ts.
const DOC_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/attachments/legacy-word-announcement.doc', import.meta.url),
)

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

  // ── Legacy Word .doc routing (Issue #133) ─────────────────────────────────

  it('routes application/msword to the legacy DOC extractor', async () => {
    const data = await readFile(DOC_FIXTURE_PATH)
    const result = await extractAttachment({
      contentType: 'application/msword',
      filename: '大会案内.doc',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toContain('申込締切: 2026年7月31日（金）必着')
  })

  it('routes application/msword + .docx filename to the DOCX extractor (mislabeled OOXML)', async () => {
    const data = await buildMinimalDocx('mislabeled modern docx')
    const result = await extractAttachment({
      contentType: 'application/msword',
      filename: 'guide.docx',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toBe('mislabeled modern docx')
  })

  it('falls back to filename suffix .doc for application/octet-stream', async () => {
    const data = await readFile(DOC_FIXTURE_PATH)
    const result = await extractAttachment({
      contentType: 'application/octet-stream',
      filename: 'annai.doc',
      data,
    })
    expect(result.status).toBe('extracted')
    expect(result.text).toContain('第12回むさしの競技かるた大会のご案内')
  })

  it('returns failed (not unsupported) for a corrupt application/msword buffer', async () => {
    const result = await extractAttachment({
      contentType: 'application/msword',
      filename: 'broken.doc',
      data: Buffer.alloc(1024, 0x42),
    })
    expect(result.status).toBe('failed')
    expect(result.text).toBeNull()
    expect(result.reason).toBeTypeOf('string')
  })
})
