import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetImageCacheForTests } from '@/lib/image-cache'

const mockRenderPdfToJpegs = vi.fn()
const mockRunLibreoffice = vi.fn()
vi.mock('@/lib/attachment-image-render', () => ({
  renderPdfToJpegs: (...args: unknown[]) => mockRenderPdfToJpegs(...args),
  runLibreofficeConvertToPdf: (...args: unknown[]) =>
    mockRunLibreoffice(...args),
}))

const {
  detectPreviewKind,
  getCachedPreviewMeta,
  getCachedPreviewPage,
  renderAttachmentPreview,
  _resetAttachmentPreviewForTests,
} = await import('@/lib/attachment-preview')

const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0x01])
const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0x02])

function pdfSource(id = 1) {
  return {
    id,
    filename: '大会要項.pdf',
    contentType: 'application/pdf',
    data: Buffer.from('%PDF-1.4 fake'),
  }
}

function docSource(id = 2) {
  return {
    id,
    filename: '32rd(A-E)多摩大会案内.doc',
    contentType: 'application/msword',
    data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  }
}

beforeEach(() => {
  _resetImageCacheForTests()
  _resetAttachmentPreviewForTests()
  mockRenderPdfToJpegs.mockReset()
  mockRunLibreoffice.mockReset()
  mockRenderPdfToJpegs.mockResolvedValue({
    pages: [JPEG_A, JPEG_B],
    truncated: false,
  })
  // The real libreoffice writes `<basename>.pdf` into outDir; the mock does
  // the same so convertToPdf's readFile finds it.
  mockRunLibreoffice.mockImplementation(
    async (_inputPath: string, outDir: string) => {
      await writeFile(join(outDir, 'input.pdf'), Buffer.from('%PDF-converted'))
    },
  )
})

describe('detectPreviewKind', () => {
  it.each([
    ['application/pdf', 'a.pdf', 'document'],
    ['application/x-pdf', 'a.pdf', 'document'],
    ['application/msword', '案内.doc', 'document'],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '名簿.xlsx',
      'document',
    ],
    ['image/jpeg', '写真.jpg', 'image'],
    ['image/heic', 'IMG_0001.HEIC', 'image'],
    ['text/plain', 'memo.txt', 'text'],
    ['text/csv', 'list.csv', 'text'],
    ['application/zip', 'archive.zip', 'none'],
    ['application/octet-stream', 'unknown.bin', 'none'],
  ])('%s + %s → %s', (ct, name, expected) => {
    expect(detectPreviewKind(ct, name)).toBe(expected)
  })

  it('falls back to the filename extension when the MIME is octet-stream', () => {
    // Real sender MUAs ship .doc as application/octet-stream.
    expect(detectPreviewKind('application/octet-stream', '案内.doc')).toBe(
      'document',
    )
    expect(detectPreviewKind('', '要項.PDF')).toBe('document')
    expect(detectPreviewKind(null, 'memo.txt')).toBe('text')
  })

  it('does NOT extension-fallback for images (binary route would serve them attachment+nosniff)', () => {
    expect(detectPreviewKind('application/octet-stream', '写真.jpg')).toBe(
      'none',
    )
  })

  it('strips MIME parameters before matching', () => {
    expect(detectPreviewKind('application/pdf; charset=utf-8', 'a.pdf')).toBe(
      'document',
    )
  })
})

describe('renderAttachmentPreview', () => {
  it('renders a PDF directly (no libreoffice) and caches pages + meta', async () => {
    const src = pdfSource()
    const meta = await renderAttachmentPreview(src)
    expect(meta).toEqual({ pageCount: 2, truncated: false })
    expect(mockRunLibreoffice).not.toHaveBeenCalled()
    expect(mockRenderPdfToJpegs).toHaveBeenCalledTimes(1)
    expect(mockRenderPdfToJpegs).toHaveBeenCalledWith(src.data)

    expect(getCachedPreviewMeta(src.id)).toEqual({
      pageCount: 2,
      truncated: false,
    })
    expect(getCachedPreviewPage(src.id, 1)?.data.equals(JPEG_A)).toBe(true)
    expect(getCachedPreviewPage(src.id, 2)?.data.equals(JPEG_B)).toBe(true)
    expect(getCachedPreviewPage(src.id, 1)?.contentType).toBe('image/jpeg')
    expect(getCachedPreviewPage(src.id, 3)).toBeNull()
  })

  it('converts Office files via libreoffice WITHOUT --writer pinning', async () => {
    const src = docSource()
    const meta = await renderAttachmentPreview(src)
    expect(meta.pageCount).toBe(2)
    expect(mockRunLibreoffice).toHaveBeenCalledTimes(1)
    const [inputPath, , options] = mockRunLibreoffice.mock.calls[0]!
    // Input tmp file carries the real extension so libreoffice's format
    // detection picks the right module.
    expect(String(inputPath)).toMatch(/input\.doc$/)
    expect(options).toEqual({ forceWriter: false })
    // The converted PDF (not the raw .doc bytes) goes to pdftoppm.
    expect(mockRenderPdfToJpegs).toHaveBeenCalledWith(
      Buffer.from('%PDF-converted'),
    )
  })

  it('converts octet-stream + .docx via the extension fallback', async () => {
    const src = {
      id: 3,
      filename: '申込書.docx',
      contentType: 'application/octet-stream',
      data: Buffer.from('PK fake'),
    }
    await renderAttachmentPreview(src)
    const [inputPath] = mockRunLibreoffice.mock.calls[0]!
    expect(String(inputPath)).toMatch(/input\.docx$/)
  })

  it('derives the input extension from the MIME when the filename has none', async () => {
    const src = {
      id: 4,
      filename: 'attachment',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: Buffer.from('PK fake'),
    }
    await renderAttachmentPreview(src)
    const [inputPath] = mockRunLibreoffice.mock.calls[0]!
    expect(String(inputPath)).toMatch(/input\.xlsx$/)
  })

  it('throws for sources that are not convertible documents', async () => {
    const src = {
      id: 5,
      filename: 'archive.zip',
      contentType: 'application/zip',
      data: Buffer.from('PK'),
    }
    await expect(renderAttachmentPreview(src)).rejects.toThrow(
      /not a convertible document/,
    )
    expect(mockRunLibreoffice).not.toHaveBeenCalled()
  })

  it('returns the cached meta without re-rendering on the second call', async () => {
    const src = pdfSource()
    await renderAttachmentPreview(src)
    const again = await renderAttachmentPreview(src)
    expect(again).toEqual({ pageCount: 2, truncated: false })
    expect(mockRenderPdfToJpegs).toHaveBeenCalledTimes(1)
  })

  it('force=true re-renders even when the meta is cached', async () => {
    const src = pdfSource()
    await renderAttachmentPreview(src)
    await renderAttachmentPreview(src, { force: true })
    expect(mockRenderPdfToJpegs).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent calls into a single conversion (in-flight dedup)', async () => {
    const src = pdfSource()
    let release!: (value: { pages: Buffer[]; truncated: boolean }) => void
    mockRenderPdfToJpegs.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const p1 = renderAttachmentPreview(src)
    const p2 = renderAttachmentPreview(src)
    await vi.waitFor(() => expect(mockRenderPdfToJpegs).toHaveBeenCalled())
    release({ pages: [JPEG_A], truncated: false })
    const [m1, m2] = await Promise.all([p1, p2])
    expect(m1).toEqual({ pageCount: 1, truncated: false })
    expect(m2).toEqual(m1)
    expect(mockRenderPdfToJpegs).toHaveBeenCalledTimes(1)
  })

  it('propagates the truncated flag from the page-capped renderer', async () => {
    mockRenderPdfToJpegs.mockResolvedValue({
      pages: [JPEG_A],
      truncated: true,
    })
    const meta = await renderAttachmentPreview(pdfSource(9))
    expect(meta.truncated).toBe(true)
    expect(getCachedPreviewMeta(9)?.truncated).toBe(true)
  })

  it('clears the in-flight slot after a failure so a retry can run', async () => {
    const src = docSource(10)
    mockRunLibreoffice.mockRejectedValueOnce(new Error('soffice crashed'))
    await expect(renderAttachmentPreview(src)).rejects.toThrow(
      'soffice crashed',
    )
    const meta = await renderAttachmentPreview(src)
    expect(meta.pageCount).toBe(2)
  })
})
