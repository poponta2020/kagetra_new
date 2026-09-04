/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { LINE_IMAGE_MAX_BYTES, normalizeReceiptImage } from './image'

/** ftyp box を含む短い HEIC 風バイト列（sharp が読めずに拒否されることを確認する用）。 */
function buildHeicStub(): Buffer {
  const brand = Buffer.from('ftypheic', 'ascii')
  const box = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]), // box size
    brand,
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x68, 0x65, 0x69, 0x63]),
  ])
  return box
}

/** PDF マジックバイトを含む短いバイト列（サーバー側で読めずに拒否されることを確認する用）。 */
function buildPdfStub(): Buffer {
  return Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')
}

async function createPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer()
}

describe('normalizeReceiptImage', () => {
  it('PNG を JPEG へ変換する（AC-6）', async () => {
    const png = await createPng(400, 300)
    const result = await normalizeReceiptImage(png)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.contentType).toBe('image/jpeg')
    const outMeta = await sharp(result.image.data).metadata()
    expect(outMeta.format).toBe('jpeg')
    const previewMeta = await sharp(result.image.previewData).metadata()
    expect(previewMeta.format).toBe('jpeg')
  })

  it('4096px を超える画像は長辺 4096px 以内に縮小される（AC-7）', async () => {
    const png = await createPng(5000, 3000)
    const result = await normalizeReceiptImage(png)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBeLessThanOrEqual(4096)
    expect(result.image.height).toBeLessThanOrEqual(4096)
    // 元画像は横長（5000x3000）なので、縮小後も横長（幅=4096）が維持される
    expect(result.image.width).toBe(4096)
    expect(result.image.height).toBeLessThan(4096)
  })

  it('4096px 以下の画像は拡大されない', async () => {
    const png = await createPng(200, 100)
    const result = await normalizeReceiptImage(png)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBe(200)
    expect(result.image.height).toBe(100)
  })

  it('縮小・quality 低下を尽くしても収まらない画像はその1枚だけ除外される（AC-7）', async () => {
    // 実際に10MB超の画像を生成すると遅いため、モジュール既定の10MB上限ではなく
    // 極端に小さい上限を明示指定して除外パスを検証する（公開シグネチャは
    // normalizeReceiptImage(input) のまま・maxBytes はデフォルト引数）。
    const png = await createPng(1200, 900)
    const result = await normalizeReceiptImage(png, 200)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(
      '画像が大きすぎて送信できません（縮小しても 10MB を超えます）。',
    )
  })

  it('既定の上限は LINE_IMAGE_MAX_BYTES(10MB) と一致する', () => {
    expect(LINE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('PDF バイト列は対応外形式として拒否される（AC-5）', async () => {
    const result = await normalizeReceiptImage(buildPdfStub())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(
      '対応していない画像形式です。JPEG または PNG を選んでください（HEIC は非対応です）。',
    )
  })

  it('HEIC バイト列は対応外形式として拒否される（AC-5）', async () => {
    const result = await normalizeReceiptImage(buildHeicStub())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(
      '対応していない画像形式です。JPEG または PNG を選んでください（HEIC は非対応です）。',
    )
  })

  it('sharp が読めない壊れたバイト列は throw せず対応外形式として拒否される', async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])

    await expect(normalizeReceiptImage(garbage)).resolves.toEqual({
      ok: false,
      reason:
        '対応していない画像形式です。JPEG または PNG を選んでください（HEIC は非対応です）。',
    })
  })

  it('metadata() は通るが画素データが途中で切れた JPEG は throw せず除外される', async () => {
    const jpeg = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 80, g: 40, b: 160 } },
    })
      .jpeg()
      .toBuffer()
    // ヘッダー・寸法は読めるが、末尾を切り落として画素データを欠損させる
    // （アップロード中断・末尾が数バイト欠けた写真を模す）。
    const truncated = jpeg.subarray(0, jpeg.length - 200)

    const result = await normalizeReceiptImage(truncated)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(
      '画像が壊れているか、途中で切れています。撮り直すか別の写真を選んでください。',
    )
  })

  it('EXIF の向き(orientation 6)を反映して回転・縦横入れ替えする', async () => {
    // 横長(800x400)の画像に orientation 6（時計回り90度回転が必要）を付与する。
    // .rotate() が EXIF を反映すると、正規化後は縦長(400x800)になる。
    const rotated = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: { r: 10, g: 200, b: 60 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const result = await normalizeReceiptImage(rotated)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBe(400)
    expect(result.image.height).toBe(800)
  })

  it('プレビューは長辺 240px 以内（LINE previewImageUrl 仕様・既存配信パイプラインと同じ規律）', async () => {
    const input = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .png()
      .toBuffer()

    const result = await normalizeReceiptImage(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const preview = await sharp(result.image.previewData).metadata()
    expect(Math.max(preview.width ?? 0, preview.height ?? 0)).toBeLessThanOrEqual(240)
    expect(result.image.previewData.byteLength).toBeLessThanOrEqual(1024 * 1024)
  })
})
