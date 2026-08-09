/**
 * 画像バイト列から QR コードの文字列を取り出す（openchat-broadcast §3.2.3）。
 *
 * 招待を運ぶメール20件のうち6件（30%）は**テキストに URL が一切なく QR 画像のみ**
 * なので（feasibility.md §2-1）、この経路が無いと機能のカバレッジが 70% で頭打ちになる。
 *
 * ★このモジュールは **サーバー専用**（sharp を使う）。client から import しないこと。
 *
 * 依存の選定理由:
 * - デコード前の画像処理は `sharp`（既存依存。本番 ARM Docker で稼働実績あり）
 * - デコーダは `jsqr`（純 JS・ネイティブビルド無し）。zxing-wasm は印刷 PDF の QR に
 *   強いが wasm 依存が増えるため不採用。実 PDF が読めないと判明した場合
 *   （AC-15 の manual 確認）は zxing-wasm への差し替えを別変更として起票する
 *
 * ★**入力は信頼できない添付バイト列**。壊れた画像・画像でないバイト列・QR の無い
 * 画像はいずれも「読み取れなかった」= null として返し、**例外を投げない**
 * （AC-13: QR デコードに失敗しても抽出全体は成功し Tier 1/2 の候補が返る）。
 */

import jsQR from 'jsqr'
import sharp from 'sharp'

/**
 * デコード前に受け付ける最大ピクセル数（約40MP ＝ 6300×6300 相当）。
 *
 * ★sharp の既定上限は約 2.68 億ピクセル（16383×16383）で、そこまで許すと
 * grayscale の raw だけで約 268MB、さらに下の RGBA 展開が
 * `pixelCount * 4` ＝ **約 1.07GB を一度に確保**し、jsQR の作業領域も乗って
 * Web プロセスが落ちる。入力は**信頼できない添付バイト列**（圧縮率の高い PNG なら
 * 数百 KB でこのサイズになる）なので、エンコード済みバイト数の上限では防げない。
 * 超過分は sharp が例外を投げ、下の catch が null にする（＝その添付だけスキップ）。
 */
const MAX_INPUT_PIXELS = 40_000_000

/**
 * デコード時の最大辺。印刷 PDF をラスタライズしたページ画像でも QR モジュールは
 * 十分に残る大きさで、かつ RGBA 展開が約 16MB に収まる（2000×2000×4）。
 */
const MAX_DECODE_EDGE = 2000

/**
 * 画像バイト列から QR の文字列をデコードする。読めなければ null。
 *
 * grayscale → normalize（コントラスト伸長）で、印刷 PDF をラスタライズした
 * 薄い・眠い画像の検出率を上げてから RGBA へ落として jsQR に渡す。jsQR は
 * RGBA の生ピクセル列しか受け取らないため、この変換は省略できない。
 */
export async function decodeQrFromImage(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .grayscale()
      .normalize()
      // ★巨大画像は QR 判定に十分な最大辺まで縮小してから raw 化する。
      // `withoutEnlargement` で小さい画像は素通り（拡大すると QR が甘くなる）。
      .resize({
        width: MAX_DECODE_EDGE,
        height: MAX_DECODE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true })

    // ★grayscale() 後の raw は 1ch のまま。`toColourspace('srgb').ensureAlpha()`
    // を挟んでも 1ch で出てくる（sharp 0.34 で実測）ので、ここで手で RGBA へ
    // 展開する。jsQR は 4ch 前提で、1ch を渡すと
    // "Malformed data passed to binarizer." を投げる。
    const pixelCount = info.width * info.height
    if (pixelCount === 0 || data.length < pixelCount * info.channels) return null
    const rgba = new Uint8ClampedArray(pixelCount * 4)
    for (let i = 0; i < pixelCount; i++) {
      const v = data[i * info.channels] ?? 0
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = 255
    }

    const result = jsQR(rgba, info.width, info.height, {
      // 白地に黒（通常）と反転の両方を試す。案内 PDF には濃色地に白抜きの
      // QR が置かれることがあり、片方だけだと取りこぼす。
      inversionAttempts: 'attemptBoth',
    })

    const text = result?.data?.trim()
    return text ? text : null
  } catch {
    // sharp が画像として解釈できない（壊れた添付・非画像バイト列）。
    // ここで投げると添付1件の破損が抽出全体を落とすため握り潰す
    // （requirements §3.2.8「添付が破損して抽出に失敗 → その添付だけスキップ」）。
    return null
  }
}

/**
 * 複数の画像（PDF/Word のページ画像など）を順にデコードし、読み取れた文字列を
 * 出現順に返す。読めなかったページは黙って飛ばす。
 *
 * ページ数の上限（`RENDER_PAGE_LIMIT`）を掛けるのは**呼び出し側**（collect.ts）の
 * 責務。この関数は渡された分だけ処理する。
 */
export async function decodeQrFromImages(buffers: readonly Buffer[]): Promise<string[]> {
  const out: string[] = []
  for (const buffer of buffers) {
    const text = await decodeQrFromImage(buffer)
    if (text) out.push(text)
  }
  return out
}
