/**
 * DOCX → plain text using mammoth.
 *
 * mammoth.extractRawText returns `{ value, messages }`; `value` is the
 * concatenation of paragraph text with double newlines between paragraphs.
 * Mammoth surfaces non-fatal issues via `messages` (e.g. unsupported style)
 * instead of throwing — fatal parse errors throw at the dynamic import or
 * extraction call. The orchestrator catches the throw and downgrades to
 * `extraction_status='failed'`.
 *
 * Refs: https://github.com/mwilliamson/mammoth.js#readme — `extractRawText`.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer })
  return value.trim()
}
