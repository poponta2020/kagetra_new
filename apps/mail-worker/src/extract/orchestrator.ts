import { extractDocxText } from './docx.js'
import { extractPdfText } from './pdf.js'
import { extractXlsxText } from './xlsx.js'

export type ExtractionStatus = 'extracted' | 'failed' | 'unsupported'

export interface ExtractionResult {
  status: ExtractionStatus
  text: string | null
  /** Populated only on `failed`; useful for log aggregation. */
  reason?: string
}

export interface ExtractionInput {
  contentType: string
  filename: string
  data: Buffer
}

type ExtractorKind = 'pdf' | 'docx' | 'xlsx'

const PDF_TYPES = new Set(['application/pdf', 'application/x-pdf'])
const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const XLSX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/**
 * content-type → extractor routing with a filename-extension tiebreaker for
 * `application/octet-stream` and other generic types. Some senders mark
 * Office attachments as octet-stream; trusting only Content-Type would
 * mis-route those to `unsupported`.
 *
 * Returns `null` when no extractor applies — the orchestrator turns this into
 * `{ status: 'unsupported' }`.
 */
function pickExtractor(contentType: string, filename: string): ExtractorKind | null {
  const ct = contentType.toLowerCase()
  if (PDF_TYPES.has(ct)) return 'pdf'
  if (DOCX_TYPES.has(ct)) return 'docx'
  if (XLSX_TYPES.has(ct)) return 'xlsx'

  // Fall through to filename suffix only when the Content-Type is unspecific.
  // This avoids overriding e.g. `image/png` just because the sender named it
  // foo.pdf.
  const generic = ct === '' || ct === 'application/octet-stream' || ct === 'binary/octet-stream'
  if (!generic) return null
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  return null
}

/**
 * Extract plain text from a single attachment.
 *
 * Each underlying extractor isolates its own failure: a corrupt PDF / DOCX /
 * XLSX surfaces as `{ status: 'failed', reason }` rather than propagating an
 * exception, so the worker pipeline can persist the binary + the failure
 * marker and keep moving through the rest of the batch.
 *
 * Empty extracted text (e.g. image-only PDF) is treated as `extracted` with
 * `text=''` — that is honest about what the extractor saw and lets PR3 still
 * fall back to AI vision on the binary.
 */
export async function extractAttachment(input: ExtractionInput): Promise<ExtractionResult> {
  const kind = pickExtractor(input.contentType, input.filename)
  if (!kind) return { status: 'unsupported', text: null }
  try {
    const text =
      kind === 'pdf'
        ? await extractPdfText(input.data)
        : kind === 'docx'
          ? await extractDocxText(input.data)
          : await extractXlsxText(input.data)
    return { status: 'extracted', text }
  } catch (err) {
    return {
      status: 'failed',
      text: null,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
