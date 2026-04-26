/**
 * PDF → plain text using pdfjs-dist's legacy Node build.
 *
 * pdfjs-dist v5 ships browser-first ESM that triggers worker warnings under
 * Node; the `legacy/build/pdf.mjs` entrypoint is the supported Node form.
 * We feed `getDocument` a `Uint8Array` view over the input Buffer (Buffer
 * instances are Uint8Array subclasses but the type signature is strict).
 *
 * Refs: https://github.com/mozilla/pdf.js (README), the canonical Node
 *       extraction example using `getDocument({ data })` + `getTextContent`.
 *
 * Notes:
 *   - We deliberately don't pass `standardFontDataUrl`. Resolving the path at
 *     runtime is fragile across the dev/build/test trees (vitest's vite-node
 *     loader doesn't provide `import.meta.resolve`, and tsup/dist sit at a
 *     different depth from `node_modules/pdfjs-dist/standard_fonts`). pdfjs
 *     only logs font warnings to stderr when the path is missing — text
 *     extraction itself does not need glyph rendering.
 *   - Image-only / scanned PDFs return an empty string (no OCR). Callers
 *     should treat empty as "no text extractable" rather than failure.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  }).promise

  // Wrap the per-page loop in try/finally so a malformed PDF that throws from
  // `getPage`/`getTextContent` still releases the pdfjs document handle.
  // Without this, the cron worker leaks worker / font buffers across runs.
  try {
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n)
      const tc = await page.getTextContent()
      pages.push(tc.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    return pages.join('\n').trim()
  } finally {
    await pdf.destroy()
  }
}
