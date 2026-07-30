import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_TOTAL_LIMIT_BYTES,
  base64EncodedBytes,
  exceededAttachmentTotalBytes,
} from '../../src/classify/attachment-budget.js'

const MiB = 1024 * 1024
const pdf = (bytes: number) => ({ contentType: 'application/pdf', sizeBytes: bytes })
const docx = (bytes: number) => ({
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: bytes,
})

/**
 * 要件 §6: Anthropic のリクエスト上限 32MB。個々が上限内でも合計で超え得るので、
 * 送る前に弾く。判定は**base64 化後**のサイズで行い、本文・プロンプト・抽出済み
 * テキスト添付は予約枠でまとめて確保する。
 */
describe('attachment-budget', () => {
  it('base64EncodedBytes は 3 バイト → 4 文字（切り上げ）', () => {
    expect(base64EncodedBytes(0)).toBe(0)
    expect(base64EncodedBytes(3)).toBe(4)
    expect(base64EncodedBytes(1)).toBe(4)
    expect(base64EncodedBytes(4)).toBe(8)
  })

  it('上限は 32MiB から予約枠 6MiB を引いた base64 枠（26MiB）を生バイトへ戻した値', () => {
    // 26MiB の base64 枠 → 生バイトは 3/4 の約 19.5MiB。
    expect(ATTACHMENT_TOTAL_LIMIT_BYTES).toBe(Math.floor((26 * MiB * 3) / 4))
    // 実際に送られるサイズが 32MiB を超えないことが本質。
    const encoded = base64EncodedBytes(ATTACHMENT_TOTAL_LIMIT_BYTES)
    expect(encoded + 6 * MiB).toBeLessThanOrEqual(32 * MiB)
  })

  it('合計が上限以内なら null', () => {
    expect(exceededAttachmentTotalBytes([])).toBeNull()
    // 実運用の要綱 PDF（0.5〜3MB）を数件選ぶ通常ケース。
    expect(
      exceededAttachmentTotalBytes([pdf(3 * MiB), pdf(3 * MiB), pdf(3 * MiB)]),
    ).toBeNull()
    // ちょうど上限は通す（超過のみ弾く）。
    expect(exceededAttachmentTotalBytes([pdf(ATTACHMENT_TOTAL_LIMIT_BYTES)])).toBeNull()
  })

  it('上限を 1 バイトでも超えたら弾く', () => {
    const over = ATTACHMENT_TOTAL_LIMIT_BYTES + 1
    expect(exceededAttachmentTotalBytes([pdf(over)])).toBe(over)
  })

  it('1件ごとの上限（8000KB）を全て満たしていても合計超過なら弾く', () => {
    // 各 7.5MiB < 8000KB(=7.81MiB)。3 件で 22.5MiB > 19.5MiB。
    const big = 7.5 * MiB
    expect(exceededAttachmentTotalBytes([pdf(big), pdf(big), pdf(big)])).toBe(3 * big)
  })

  it('生バイトではなく base64 化後で判定する（4/3 の差を取りこぼさない）', () => {
    // 生 20MiB は「32MiB 以内」に見えるが、base64 で約 27.96MB になり、
    // 予約枠 6MiB を足すと 32MiB を超える。
    expect(exceededAttachmentTotalBytes([pdf(20 * MiB)])).toBe(20 * MiB)
  })

  it('PDF 以外は合計に数えない（予約枠でまとめて確保している）', () => {
    expect(exceededAttachmentTotalBytes([pdf(19 * MiB), docx(19 * MiB)])).toBeNull()
  })
})
