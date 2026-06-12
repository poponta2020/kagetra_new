import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderPdfToJpegs,
  runLibreofficeConvertToPdf,
} from '@/lib/attachment-image-render'
import { getCachedImage, setCachedImage } from '@/lib/image-cache'

/**
 * In-app attachment preview: renders mail attachments to JPEG page images so
 * the admin UI can show them inside its own viewer page with a close button.
 *
 * Why not just link to the binary route? The iOS home-screen PWA navigates
 * same-origin URLs in its own WebView even with `target="_blank"` (everything
 * under the manifest `scope: "/"` is "in app"), and a navigated-to document
 * has no browser chrome — no back button, no ✕, nothing. The only way out is
 * killing the app. An <iframe> viewer is no better: iOS Safari
 * renders only the FIRST page of a PDF inside an iframe, a known WebKit
 * limitation with no workaround. Plain <img> pages are the one rendering
 * primitive that behaves everywhere, so we reuse the proven
 * libreoffice → pdftoppm pipeline from the LINE mail-body path (PR #84).
 *
 * Pipeline per attachment:
 *   - PDF           → renderPdfToJpegs directly
 *   - Office (.doc/.docx/.xls/.xlsx/.ppt/.pptx)
 *                   → libreoffice --convert-to pdf (module auto-detect; NOT
 *                     --writer, which would mis-render Calc/Impress inputs)
 *                   → renderPdfToJpegs
 *   - raster images / text are NOT handled here — the viewer page serves
 *     those via <img> on the binary route / inline <pre> respectively.
 *
 * Results land in the shared in-memory image-cache (globalThis-pinned, LRU
 * capped) under `attpv:` keys, so repeat opens are instant until process
 * restart or TTL expiry. Conversion of a 30-page document costs seconds of
 * libreoffice/pdftoppm time; the in-flight registry below collapses the
 * burst of parallel <img> fetches a fresh viewer page fires into a single
 * conversion run.
 *
 * Security: inputs are UNTRUSTED sender files, same threat model as the
 * existing mail-body HTML path. libreoffice runs headless (no macro
 * execution), under the same subprocess timeout, and the only bytes that
 * ever reach a browser are pdftoppm's JPEG output — inert by construction.
 */

export type AttachmentPreviewKind = 'document' | 'image' | 'text' | 'none'

const PDF_CONTENT_TYPES = new Set(['application/pdf', 'application/x-pdf'])

const OFFICE_CONTENT_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/**
 * Raster images the binary route serves inline with their real MIME (its
 * fail-closed allowlist) — the viewer can point an <img> straight at it.
 * Kept in sync with INLINE_ALLOWED_CONTENT_TYPES in the binary route; SVG is
 * active content and must never appear here.
 */
const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
])

const TEXT_CONTENT_TYPES = new Set(['text/plain', 'text/csv'])

/** Extensions accepted as conversion input when the MIME is unhelpful. */
const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
])

const TEXT_EXTENSIONS = new Set(['txt', 'csv'])

/** MIME → conversion input extension, for files with no usable extension. */
const OFFICE_EXTENSION_BY_TYPE: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
}

/** Strip parameters (`; charset=…`) and normalize case, mirroring the binary route. */
export function normalizeContentType(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
}

function fileExtension(filename: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(filename)
  return m?.[1]?.toLowerCase() ?? ''
}

/**
 * Decide how the viewer page should present an attachment.
 *
 * Declared MIME wins; when it is unhelpful (octet-stream, blank, malformed —
 * real sender MUAs ship `.doc` as octet-stream) the filename extension is
 * consulted for the conversion-based kinds. The `image` kind intentionally
 * has NO extension fallback: it is served through the binary route, whose
 * inline allowlist keys off the declared MIME — an octet-stream "image"
 * would come back `attachment; nosniff` and render nothing.
 */
export function detectPreviewKind(
  contentType: string | null | undefined,
  filename: string,
): AttachmentPreviewKind {
  const ct = normalizeContentType(contentType)
  if (IMAGE_CONTENT_TYPES.has(ct)) return 'image'
  if (PDF_CONTENT_TYPES.has(ct) || OFFICE_CONTENT_TYPES.has(ct)) {
    return 'document'
  }
  if (TEXT_CONTENT_TYPES.has(ct)) return 'text'
  const ext = fileExtension(filename)
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'none'
}

export interface AttachmentPreviewSource {
  id: number
  filename: string
  contentType: string | null
  data: Buffer
}

export interface AttachmentPreviewMeta {
  pageCount: number
  truncated: boolean
}

const metaKey = (id: number): string => `attpv:${id}:meta`
const pageKey = (id: number, page: number): string => `attpv:${id}:${page}`

/**
 * In-flight conversion registry. A fresh viewer page fires its page <img>
 * requests in parallel; without this, N cache misses would spawn N
 * libreoffice processes for the same attachment. globalThis-pinned for the
 * same reason as image-cache (Issue #128): Next.js chunk splitting can give
 * the Server Component and the Route Handler different module instances.
 */
const globalRef = globalThis as unknown as {
  __kagetraAttachmentPreviewInflight?: Map<
    number,
    Promise<AttachmentPreviewMeta>
  >
}
const inflight: Map<number, Promise<AttachmentPreviewMeta>> =
  (globalRef.__kagetraAttachmentPreviewInflight ??= new Map())

export function getCachedPreviewMeta(
  id: number,
): AttachmentPreviewMeta | null {
  const hit = getCachedImage(metaKey(id))
  if (!hit) return null
  try {
    const parsed: unknown = JSON.parse(hit.data.toString('utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as AttachmentPreviewMeta).pageCount === 'number' &&
      typeof (parsed as AttachmentPreviewMeta).truncated === 'boolean'
    ) {
      return parsed as AttachmentPreviewMeta
    }
    return null
  } catch {
    return null
  }
}

export function getCachedPreviewPage(
  id: number,
  page: number,
): { data: Buffer; contentType: string } | null {
  return getCachedImage(pageKey(id, page))
}

function isPdfSource(source: AttachmentPreviewSource): boolean {
  return (
    PDF_CONTENT_TYPES.has(normalizeContentType(source.contentType)) ||
    fileExtension(source.filename) === 'pdf'
  )
}

/**
 * Pick the tmp-file extension libreoffice uses for format detection. The
 * basename is always our own constant (`input.<ext>`), so the
 * attacker-controlled filename can contribute at most a short [a-z0-9]
 * extension — no path traversal surface.
 */
function conversionExtension(source: AttachmentPreviewSource): string {
  const ext = fileExtension(source.filename)
  if (ext !== 'pdf' && DOCUMENT_EXTENSIONS.has(ext)) return ext
  const byType =
    OFFICE_EXTENSION_BY_TYPE[normalizeContentType(source.contentType)]
  if (byType) return byType
  throw new Error(
    `attachment ${source.id} is not a convertible document (type=${source.contentType ?? ''}, name=${source.filename})`,
  )
}

async function convertToPdf(source: AttachmentPreviewSource): Promise<Buffer> {
  if (isPdfSource(source)) return source.data
  const workDir = await mkdtemp(join(tmpdir(), 'kagetra-attpv-'))
  try {
    const inputPath = join(workDir, `input.${conversionExtension(source)}`)
    await writeFile(inputPath, source.data)
    // forceWriter: false — Office attachments must open in their own
    // libreoffice module (Calc for .xlsx, Impress for .pptx). The --writer
    // flag exists for the HTML mail-body path only (issue #93).
    await runLibreofficeConvertToPdf(inputPath, workDir, { forceWriter: false })
    return await readFile(join(workDir, 'input.pdf'))
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup; the tmp reaper sweeps leftovers eventually.
    })
  }
}

async function renderAndCache(
  source: AttachmentPreviewSource,
): Promise<AttachmentPreviewMeta> {
  const pdfBuffer = await convertToPdf(source)
  const { pages, truncated } = await renderPdfToJpegs(pdfBuffer)
  pages.forEach((buf, i) => {
    setCachedImage(pageKey(source.id, i + 1), buf, 'image/jpeg')
  })
  const meta: AttachmentPreviewMeta = { pageCount: pages.length, truncated }
  // Meta is written AFTER the pages: the LRU evicts oldest-first, so a
  // surviving meta with evicted pages is possible — the route handles that
  // by re-rendering with force=true on a page miss.
  setCachedImage(
    metaKey(source.id),
    Buffer.from(JSON.stringify(meta), 'utf8'),
    'application/json',
  )
  return meta
}

/**
 * Render an attachment's preview pages into the image cache (idempotent).
 *
 * Returns the cached meta when present (unless `force`), otherwise converts
 * and caches. Concurrent calls for the same attachment share one conversion.
 * Throws when conversion fails (libreoffice missing / corrupt file); callers
 * degrade to a download-link card.
 */
export async function renderAttachmentPreview(
  source: AttachmentPreviewSource,
  options: { force?: boolean } = {},
): Promise<AttachmentPreviewMeta> {
  if (!options.force) {
    const cached = getCachedPreviewMeta(source.id)
    if (cached) return cached
  }
  const existing = inflight.get(source.id)
  if (existing) return existing
  const promise = renderAndCache(source)
  inflight.set(source.id, promise)
  try {
    return await promise
  } finally {
    inflight.delete(source.id)
  }
}

export function _resetAttachmentPreviewForTests(): void {
  inflight.clear()
}
