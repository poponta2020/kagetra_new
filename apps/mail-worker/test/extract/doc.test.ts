import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractDocText } from '../../src/extract/doc.js'

/**
 * `legacy-word-announcement.doc` is the one committed binary fixture in this
 * tree: a Word 97 OLE compound file cannot reasonably be assembled in memory
 * the way `builders.ts` does for PDF/DOCX (512-byte FAT sectors, directory
 * tree, FIB + piece table). It was generated from a fully synthetic Japanese
 * announcement (fictional 「むさしの」 tournament, example.com contact) via
 * LibreOffice: `soffice --headless --writer --convert-to "doc:MS Word 97"`.
 * 9 KB. Japanese text exercises the UTF-16 character runs of the format —
 * the production failure this guards against (Issue #133, 多摩大会) was a
 * Japanese-language .doc whose deadline never reached the AI.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/attachments/legacy-word-announcement.doc', import.meta.url),
)

describe('extractDocText', () => {
  it('extracts Japanese body text from a legacy Word 97 binary', async () => {
    const buffer = await readFile(FIXTURE_PATH)
    const text = await extractDocText(buffer)
    expect(text).toContain('第12回むさしの競技かるた大会のご案内')
    expect(text).toContain('申込締切: 2026年7月31日（金）必着')
    expect(text).toContain('参加費: 2,000円')
    expect(text).toContain('定員: A級32名 B級48名')
  })

  it('throws on a non-OLE buffer — orchestrator catches this and marks failed', async () => {
    // RTF is the classic .doc impostor (old editors saved RTF under a .doc
    // name). Pad past the 512-byte OLE header read so the magic check itself
    // is what rejects, not a short-read edge case.
    const rtf = Buffer.concat([Buffer.from('{\\rtf1 not an OLE file}'), Buffer.alloc(1024)])
    await expect(extractDocText(rtf)).rejects.toThrow()
  })
})
