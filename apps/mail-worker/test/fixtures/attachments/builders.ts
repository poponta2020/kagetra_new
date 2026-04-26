import JSZip from 'jszip'
import * as XLSX from 'xlsx'

/**
 * Minimal-but-valid binary builders for the attachment extractor tests.
 *
 * The goal isn't a "rich" PDF/DOCX/XLSX — just enough that pdfjs-dist /
 * mammoth / xlsx accept the input and surface the embedded text so we can
 * verify the extractor wires up correctly. Generating in memory keeps fixture
 * commits small and avoids checking in opaque binaries.
 */

/**
 * Build a minimal PDF 1.4 document with a single page containing one
 * Helvetica `Tj` showing `text`. The hand-rolled xref offsets are computed
 * from the assembled byte stream so the file passes pdfjs-dist's structural
 * validation. PDF spec: ISO 32000-1, §7.5.4 (cross-reference table).
 */
export function buildMinimalPdf(text: string): Buffer {
  const escapeText = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = `BT /F1 24 Tf 72 720 Td (${escapeText(text)}) Tj ET`
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let body = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'binary'))
    body += obj
  }
  const xrefStart = Buffer.byteLength(body, 'binary')
  let xref = `xref\n0 ${objects.length + 1}\n`
  xref += '0000000000 65535 f \n'
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body + xref + trailer, 'binary')
}

/**
 * Build a minimal Office Open XML word document containing a single paragraph
 * with `text`. Mammoth's parser needs the exact content-types map +
 * `_rels/.rels` skeleton — anything less and `extractRawText` throws. Refs:
 * ECMA-376 §17.2.1 (document body) and §11 (package relationships).
 */
export async function buildMinimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/>' +
      '</Relationships>',
  )
  const escapeXml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:body>` +
      '</w:document>',
  )
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return buf
}

/**
 * Build a minimal XLSX with one sheet whose cells contain `rows`. Uses the
 * `xlsx` lib already required by the extractor, so the round-trip exercises
 * the same parser path the real attachment pipeline uses.
 */
export function buildMinimalXlsx(sheetName: string, rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * Random bytes preceded by `%PDF-1.4` so pdfjs accepts the magic but rejects
 * the body. Used to verify the orchestrator downgrades to `failed` rather
 * than throwing.
 */
export function buildCorruptPdf(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n', 'binary'), Buffer.from('not a real pdf body')])
}
