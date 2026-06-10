/**
 * Legacy Word (.doc / application/msword) → plain text using word-extractor.
 *
 * word-extractor parses the OLE2 compound file directly (pure JS, no native
 * deps — dependencies are saxes/yauzl only, both used for its .docx side).
 * Chosen over a LibreOffice subprocess because the existing extractors
 * (mammoth, pdfjs-dist) are also in-process, the worker's test/CI envs have
 * no soffice binary, and unlike `xlsx@0.18.5` (dropped in PR2) it carries no
 * known high-severity advisories. Japanese text is stored as UTF-16 runs in
 * the Word 97+ format, so no codepage guessing is involved.
 *
 * Tournament announcements authored in old Word builds frequently place the
 * key facts (deadline tables, fee boxes) inside floating text boxes, which
 * are NOT part of the main body stream — so the body and the body's text
 * boxes are concatenated. Header/footer text boxes stay excluded to mirror
 * mammoth's body-only behaviour for .docx.
 *
 * Fatal parse errors (corrupt OLE, RTF masquerading as .doc) reject; the
 * orchestrator catches and downgrades to `extraction_status='failed'`.
 *
 * Refs: https://github.com/morungos/node-word-extractor#readme
 */
export async function extractDocText(buffer: Buffer): Promise<string> {
  const { default: WordExtractor } = await import('word-extractor')
  const extractor = new WordExtractor()
  const doc = await extractor.extract(buffer)
  const body = doc.getBody().trim()
  const textboxes = doc.getTextboxes({ includeHeadersAndFooters: false }).trim()
  if (!textboxes) return body
  if (!body) return textboxes
  return `${body}\n${textboxes}`
}
