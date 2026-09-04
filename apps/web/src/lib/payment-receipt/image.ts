/**
 * 支払報告の証憑画像を LINE 送信用に正規化するユーティリティ。
 *
 * サーバー側で必ず再検証・再正規化する（クライアントを信用しない。要件 §3.2.2 / 実装手順書「画像の扱い」）:
 *   1. sharp で metadata を読み、JPEG / PNG 以外（PDF・HEIC 等）を拒否
 *   2. EXIF の向きを反映（.rotate()）
 *   3. 長辺 4096px 以内へ縮小（拡大はしない）
 *   4. JPEG 化。10MB を超えるうちは quality を段階的に下げる。
 *      それでも収まらない1枚はその枚だけ除外して理由を返す
 *   5. 長辺 240px・1MB 以内のプレビュー JPEG を別途生成（LINE previewImageUrl 仕様）
 *
 * apps/web/src/lib/line-broadcast.ts の本文画像正規化（4096px 上限・10MB 上限・
 * quality 段階調整・プレビュー別生成）と同じ規律に揃えている。ただしコピーして
 * 共通化はしない（今回のスコープ外）。
 *
 * HEIC は sharp 0.34 / libvips 8.17.3 の heif 入力が .avif のみ対応でデコード
 * 不可（要件 §3.2.2-6）。metadata() が読めた場合も format が 'heif' になり
 * jpeg/png 判定で弾かれる。metadata() 自体が読めない壊れたバイト列（PDF 等）は
 * catch して対応外形式と同じ扱いにする（throw しない）。
 */

/** sharp の Sharp インスタンス型（重い native module の実 import は使用直前まで遅延する）。 */
type SharpInstance = import('sharp').Sharp

/** LINE image message の originalContentUrl 上限（公式仕様）。 */
export const LINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** LINE image message の長辺上限（公式仕様）。 */
const MAX_DIMENSION = 4096
/**
 * プレビュー画像の長辺上限。LINE の `previewImageUrl` は **JPEG・1MB 以内・240x240**
 * が公式仕様で、既存の要綱配信パイプライン（`lib/line-broadcast.ts`）も同じ理由で
 * 240 に縮めている —— 大判のプレビューは LINE 側の取得に失敗し、**配信全体が
 * partial / failed に倒れる**実績がある。履歴のサムネは 56px 表示なので 240 で足りる。
 */
const PREVIEW_MAX_DIMENSION = 240
/** プレビュー画像の容量上限。 */
const PREVIEW_MAX_BYTES = 1 * 1024 * 1024

/** quality を段階的に下げながら上限に収める際の候補値。 */
const JPEG_QUALITY_STEPS = [85, 75, 65, 50, 35, 20] as const

const UNSUPPORTED_FORMAT_REASON =
  '対応していない画像形式です。JPEG または PNG を選んでください（HEIC は非対応です）。'
const SIZE_EXCEEDED_REASON = '画像が大きすぎて送信できません（縮小しても 10MB を超えます）。'

/** 正規化に成功した1枚。 */
export interface NormalizedReceiptImage {
  data: Buffer // 送信・保存する JPEG 本体
  byteSize: number
  width: number
  height: number
  previewData: Buffer // 長辺240px・1MB以内の JPEG
  contentType: 'image/jpeg'
}

/** 1枚ぶんの正規化結果。除外されたときは reason に日本語の理由が入る。 */
export type NormalizeReceiptResult =
  | { ok: true; image: NormalizedReceiptImage }
  | { ok: false; reason: string }

/**
 * quality を JPEG_QUALITY_STEPS の順に下げながら maxBytes 以内に収まるバッファを
 * 探す。最後まで収まらなければ最小 quality の結果と withinLimit: false を返し、
 * 除外するかどうかの判断は呼び出し側に委ねる。
 */
async function encodeJpegWithinLimit(
  pipeline: SharpInstance,
  maxBytes: number,
): Promise<{ buffer: Buffer; withinLimit: boolean }> {
  let buffer: Buffer | null = null
  for (const quality of JPEG_QUALITY_STEPS) {
    buffer = await pipeline.clone().jpeg({ quality }).toBuffer()
    if (buffer.byteLength <= maxBytes) {
      return { buffer, withinLimit: true }
    }
  }
  // JPEG_QUALITY_STEPS は空でないため buffer は必ず代入されている
  return { buffer: buffer as Buffer, withinLimit: false }
}

/**
 * 証憑画像1枚を LINE 送信用の JPEG（本体・プレビュー）へ正規化する。
 *
 * throw しない。対応外形式・破損データ・サイズ超過はいずれも
 * `{ ok: false, reason }` として返す（呼び出し側が枚ごとに try/catch しなくて済むように）。
 *
 * @param maxBytes 本体 JPEG の容量上限（既定は LINE_IMAGE_MAX_BYTES）。テストで
 *   小さい値へ差し替えることで、実際に10MB超の画像を生成せずに除外パスを検証できる。
 */
export async function normalizeReceiptImage(
  input: Buffer,
  maxBytes: number = LINE_IMAGE_MAX_BYTES,
): Promise<NormalizeReceiptResult> {
  // sharp は重い native module のため、実際に使う直前まで import を遅延する
  const { default: sharp } = await import('sharp')

  let format: string | undefined
  try {
    const metadata = await sharp(input).metadata()
    format = metadata.format
  } catch {
    // 壊れたバイト列・sharp が読めない形式（PDF 等）は対応外形式と同じ扱い
    return { ok: false, reason: UNSUPPORTED_FORMAT_REASON }
  }

  if (format !== 'jpeg' && format !== 'png') {
    // PNG/JPEG 以外（HEIC 含む）はここで拒否する
    return { ok: false, reason: UNSUPPORTED_FORMAT_REASON }
  }

  // EXIF の向きを反映しつつ長辺 4096px 以内へ縮小（拡大はしない）
  const resized = sharp(input)
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })

  const main = await encodeJpegWithinLimit(resized, maxBytes)
  if (!main.withinLimit) {
    // 縮小・quality 低下を尽くしても収まらない1枚はこの枚だけ除外する
    return { ok: false, reason: SIZE_EXCEEDED_REASON }
  }

  const mainMetadata = await sharp(main.buffer).metadata()

  // プレビューは正規化済みの本体からさらに縮小する（ベストエフォート。長辺240px
  // まで縮めれば確実に1MB以内に収まるため、収まらなくても送信自体は失敗させない）
  const previewPipeline = sharp(main.buffer).resize({
    width: PREVIEW_MAX_DIMENSION,
    height: PREVIEW_MAX_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const preview = await encodeJpegWithinLimit(previewPipeline, PREVIEW_MAX_BYTES)

  return {
    ok: true,
    image: {
      data: main.buffer,
      byteSize: main.buffer.byteLength,
      width: mainMetadata.width ?? 0,
      height: mainMetadata.height ?? 0,
      previewData: preview.buffer,
      contentType: 'image/jpeg',
    },
  }
}
