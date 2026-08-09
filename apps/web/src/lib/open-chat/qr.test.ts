import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeQrFromImage, decodeQrFromImages } from './qr'

const FIXTURE_DIR = join(__dirname, '__fixtures__')

/** フィクスチャ生成時に埋め込んだ文字列（架空トークン）。 */
const FIXTURE_URL = 'https://line.me/ti/g2/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'

async function fixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURE_DIR, name))
}

describe('decodeQrFromImage', () => {
  it('AC-10: QR を含む画像から URL をデコードする', async () => {
    const buffer = await fixture('qr-openchat-invite.png')
    await expect(decodeQrFromImage(buffer)).resolves.toBe(FIXTURE_URL)
  })

  it('QR の無い画像では null を返す', async () => {
    const buffer = await fixture('no-qr-plain.png')
    await expect(decodeQrFromImage(buffer)).resolves.toBeNull()
  })

  it('壊れたバイト列でも例外を投げず null になる', async () => {
    // sharp が画像として解釈できないバイト列。添付1件の破損が抽出全体を
    // 落とさないことの担保（AC-13）。
    const broken = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])
    await expect(decodeQrFromImage(broken)).resolves.toBeNull()
  })

  it('空バッファでも例外を投げず null になる', async () => {
    await expect(decodeQrFromImage(Buffer.alloc(0))).resolves.toBeNull()
  })

  it('PNG ヘッダだけあって本体が壊れていても null になる', async () => {
    const truncated = (await fixture('qr-openchat-invite.png')).subarray(0, 40)
    await expect(decodeQrFromImage(truncated)).resolves.toBeNull()
  })
})

describe('decodeQrFromImages', () => {
  it('読み取れたページの文字列だけを出現順に返す', async () => {
    const qr = await fixture('qr-openchat-invite.png')
    const plain = await fixture('no-qr-plain.png')
    // 1ページ目は QR 無し、2ページ目に QR — 案内 PDF の典型的な並び。
    await expect(decodeQrFromImages([plain, qr, plain])).resolves.toEqual([FIXTURE_URL])
  })

  it('1件も読めなければ空配列を返す', async () => {
    const plain = await fixture('no-qr-plain.png')
    await expect(decodeQrFromImages([plain])).resolves.toEqual([])
  })
})
