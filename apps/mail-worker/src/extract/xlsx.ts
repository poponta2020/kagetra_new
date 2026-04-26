/**
 * XLSX → plain text using SheetJS Community Edition (xlsx@0.18.5, latest
 * npm-published). For each sheet we emit a `=== <sheetName> ===` header
 * followed by the CSV projection so AI prompts (PR3) can keep table shape
 * without a heavy schema.
 *
 * Refs: https://docs.sheetjs.com/docs/api/parse-options (`type: 'buffer'` is
 *       required to disambiguate from path/string inputs) and
 *       https://docs.sheetjs.com/docs/api/utilities/csv (sheet_to_csv).
 */
export async function extractXlsxText(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    if (!ws) continue
    const csv = XLSX.utils.sheet_to_csv(ws).trimEnd()
    parts.push(`=== ${sheetName} ===\n${csv}`)
  }
  return parts.join('\n\n').trim()
}
