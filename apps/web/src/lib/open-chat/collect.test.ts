import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRenderPdfToJpegs = vi.fn()
const mockRunLibreoffice = vi.fn()
// r-note: attachment-image-render.ts の RENDER_PAGE_LIMIT を実体のまま残す
// （importOriginal で spread）。全体を上書きすると collect.ts 側が import する
// RENDER_PAGE_LIMIT が undefined になり、AC-14 のページ数上限チェックが
// 「何も切っていないのに通ってしまう」false green になる。
vi.mock('@/lib/attachment-image-render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachment-image-render')>()),
  renderPdfToJpegs: (...args: unknown[]) => mockRenderPdfToJpegs(...args),
  runLibreofficeConvertToPdf: (...args: unknown[]) => mockRunLibreoffice(...args),
}))

// qr.ts は pass-through spy にする: AC-11 のフィクスチャ画像は実際に jsQR で
// デコードさせつつ、AC-12/AC-14 では「デコーダに何枚渡されたか」を
// mock.calls から検証したい。完全 mock だと前者が、完全実体だと後者が壊れる。
const actualQr = await vi.importActual<typeof import('./qr')>('./qr')
const mockDecodeQrFromImage = vi.fn(actualQr.decodeQrFromImage)
const mockDecodeQrFromImages = vi.fn(actualQr.decodeQrFromImages)
// r-note: mockDecodeQrFromImage/Images は vi.fn(実装) で作っているため引数型が
// 確定しており、(...args: unknown[]) のスプレッドは TS2556 で落ちる
// （attachment-preview.test.ts の vi.fn() ノーアーギュメント版とはここが違う）。
// factory 側は実シグネチャで受けて中継する。
vi.mock('./qr', () => ({
  decodeQrFromImage: (buffer: Buffer) => mockDecodeQrFromImage(buffer),
  decodeQrFromImages: (buffers: readonly Buffer[]) => mockDecodeQrFromImages(buffers),
}))

const { collectOpenChatCandidates } = await import('./collect')
const { RENDER_PAGE_LIMIT } = await import('@/lib/attachment-image-render')

const FIXTURE_DIR = join(__dirname, '__fixtures__')
/** qr-openchat-invite.png に埋め込まれた文字列（qr.test.ts と共有）。 */
const FIXTURE_URL = 'https://line.me/ti/g2/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'

async function fixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

function textAttachment(
  extractedText: string | null,
  overrides: Partial<{ filename: string; contentType: string | null }> = {},
) {
  return {
    filename: overrides.filename ?? 'body.txt',
    contentType: overrides.contentType ?? 'text/plain',
    data: Buffer.from(''),
    extractedText,
  }
}

beforeEach(() => {
  mockRenderPdfToJpegs.mockReset()
  mockRunLibreoffice.mockReset()
  // 実データを与えていないテストで document 経路に入っても暴走しないよう、
  // 空ページのデフォルトを敷いておく。
  mockRenderPdfToJpegs.mockResolvedValue({ pages: [], truncated: false })
  mockRunLibreoffice.mockImplementation(async (_inputPath: string, outDir: string) => {
    await writeFile(join(outDir, 'input.pdf'), Buffer.from('%PDF-converted'))
  })

  mockDecodeQrFromImage.mockReset()
  mockDecodeQrFromImage.mockImplementation(actualQr.decodeQrFromImage)
  mockDecodeQrFromImages.mockReset()
  mockDecodeQrFromImages.mockImplementation(actualQr.decodeQrFromImages)
})

describe('collectOpenChatCandidates', () => {
  it('本文のみで候補が返る', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: `オープンチャットはこちら ${FIXTURE_URL} からご参加ください。`,
      attachments: [],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([
      expect.objectContaining({ url: FIXTURE_URL, sources: ['body'] }),
    ])
  })

  it('添付テキストのみで候補が返り、出典が attachment_text', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [textAttachment(`案内: ${FIXTURE_URL}`)],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([
      expect.objectContaining({ url: FIXTURE_URL, sources: ['attachment_text'] }),
    ])
  })

  it('画像添付（jpeg/png）の QR がデコーダに渡され、得られた URL が候補に加わる（AC-11）', async () => {
    const qrImage = await fixture('qr-openchat-invite.png')
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: 'invite-qr.png',
          contentType: 'image/png',
          data: qrImage,
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(mockDecodeQrFromImage).toHaveBeenCalledWith(qrImage)
    expect(result.candidates).toEqual([expect.objectContaining({ url: FIXTURE_URL, sources: ['qr'] })])
  })

  it('QR の無い画像添付では候補が増えない', async () => {
    const plainImage = await fixture('no-qr-plain.png')
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          data: plainImage,
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([])
  })

  it('gif 等 jpeg/png 以外の画像は QR 走査の対象外（仕様どおりの絞り込み）', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: 'photo.gif',
          contentType: 'image/gif',
          data: Buffer.from([0x47, 0x49, 0x46]),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(mockDecodeQrFromImage).not.toHaveBeenCalled()
    expect(result.candidates).toEqual([])
  })

  it('PDF 添付では renderPdfToJpegs 経由のページ画像がデコーダへ渡る（AC-12）', async () => {
    const qrImage = await fixture('qr-openchat-invite.png')
    const plainImage = await fixture('no-qr-plain.png')
    mockRenderPdfToJpegs.mockResolvedValue({ pages: [plainImage, qrImage], truncated: false })

    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: '大会要項.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF-1.4 fake'),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })

    expect(mockRenderPdfToJpegs).toHaveBeenCalledWith(
      Buffer.from('%PDF-1.4 fake'),
      { maxPages: RENDER_PAGE_LIMIT },
    )
    expect(mockDecodeQrFromImages).toHaveBeenCalledWith([plainImage, qrImage])
    expect(result.candidates).toEqual([expect.objectContaining({ url: FIXTURE_URL, sources: ['qr'] })])
  })

  it('Word 添付は libreoffice で PDF に変換してからページ画像化する', async () => {
    const qrImage = await fixture('qr-openchat-invite.png')
    mockRenderPdfToJpegs.mockResolvedValue({ pages: [qrImage], truncated: false })

    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: '大会案内.doc',
          contentType: 'application/msword',
          data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })

    expect(mockRunLibreoffice).toHaveBeenCalledTimes(1)
    const [inputPath, , options] = mockRunLibreoffice.mock.calls[0]!
    expect(String(inputPath)).toMatch(/input\.doc$/)
    expect(options).toEqual({ forceWriter: false })
    expect(mockRenderPdfToJpegs).toHaveBeenCalledWith(
      Buffer.from('%PDF-converted'),
      { maxPages: RENDER_PAGE_LIMIT },
    )
    expect(result.candidates).toEqual([expect.objectContaining({ url: FIXTURE_URL, sources: ['qr'] })])
  })

  it('AC-14: レンダラ/デコーダに渡すページ数が RENDER_PAGE_LIMIT を超えない', async () => {
    // mock が上限超のページ数を返しても、collect.ts 側で切ってからデコーダへ渡すこと。
    const overLimitPages = Array.from({ length: RENDER_PAGE_LIMIT + 5 }, (_, i) =>
      Buffer.from([0xff, 0xd8, 0xff, i]),
    )
    mockRenderPdfToJpegs.mockResolvedValue({ pages: overLimitPages, truncated: true })

    await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: '大量ページ.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF-1.4 fake'),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })

    expect(mockRenderPdfToJpegs).toHaveBeenCalledWith(expect.any(Buffer), {
      maxPages: RENDER_PAGE_LIMIT,
    })
    const decodedPages = mockDecodeQrFromImages.mock.calls[0]?.[0] as Buffer[] | undefined
    expect(decodedPages?.length).toBeLessThanOrEqual(RENDER_PAGE_LIMIT)
    expect(decodedPages?.length).toBe(RENDER_PAGE_LIMIT)
  })

  it('AC-13: QR デコードに失敗しても Tier1/2 の候補は返る', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: `本文中の候補 ${FIXTURE_URL}`,
      attachments: [
        {
          filename: 'broken.png',
          contentType: 'image/png',
          // 画像として解釈できないバイト列。qr.ts は例外を投げず null を返す仕様
          // （decodeQrFromImage 自体の担保）だが、collect.ts 側もこの経路で
          // 落ちないことを確認する。
          data: Buffer.from([0x00, 0x01, 0x02, 0x03]),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([expect.objectContaining({ url: FIXTURE_URL, sources: ['body'] })])
  })

  it('添付1件が壊れて（レンダリングで例外が出る）も他の候補で続行する', async () => {
    mockRenderPdfToJpegs.mockRejectedValueOnce(new Error('pdftoppm crashed'))
    const otherUrl = 'https://line.me/ti/g2/OtherTokenAaaBbbCccDddEeeFff'

    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: '壊れたPDF.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('not really a pdf'),
          extractedText: null,
        },
        textAttachment(`もう一つの候補 ${otherUrl}`),
      ],
      groupEventDates: [],
    })

    expect(result.candidates).toEqual([
      expect.objectContaining({ url: otherUrl, sources: ['attachment_text'] }),
    ])
  })

  it('同一 URL が本文と QR の両方から見つかると1候補にまとまり、出典が併記される', async () => {
    const qrImage = await fixture('qr-openchat-invite.png')
    const result = await collectOpenChatCandidates({
      bodyText: `本文にも同じ招待 ${FIXTURE_URL} があります。`,
      attachments: [
        {
          filename: 'invite-qr.png',
          contentType: 'image/png',
          data: qrImage,
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([
      expect.objectContaining({ url: FIXTURE_URL, sources: ['body', 'qr'] }),
    ])
  })

  it('候補ゼロのときは空配列を返す（AC-20）', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '大会の詳細は追ってご連絡します。',
      attachments: [],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([])
  })
})

describe('QR 読み取り失敗の可視化（requirements §3.2.3 / PR #469 R1）', () => {
  it('QR を走査したが読めなかった添付名を返す', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        { filename: 'noqr.png', contentType: 'image/png', data: await fixture('no-qr-plain.png'), extractedText: null },
      ],
      groupEventDates: [],
    })
    expect(result.candidates).toEqual([])
    // ★「QR が無かった」と「読めなかった」を呼び出し側が区別できること。
    // これが無いと画面は「いずれにも招待 URL がありませんでした」と断定してしまう。
    expect(result.qrUnreadAttachments).toEqual(['noqr.png'])
  })

  it('QR が読めた添付は警告に載せない', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        { filename: 'qr.png', contentType: 'image/png', data: await fixture('qr-openchat-invite.png'), extractedText: null },
      ],
      groupEventDates: [],
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.qrUnreadAttachments).toEqual([])
  })

  it('QR 走査の対象外（xlsx 等）は警告に載せない', async () => {
    const result = await collectOpenChatCandidates({
      bodyText: '',
      attachments: [
        {
          filename: 'roster.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: Buffer.from('dummy'),
          extractedText: null,
        },
      ],
      groupEventDates: [],
    })
    expect(result.qrUnreadAttachments).toEqual([])
  })
})
