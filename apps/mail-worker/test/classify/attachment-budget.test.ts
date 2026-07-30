import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_TOTAL_LIMIT_BYTES,
  exceededAttachmentTotalBytes,
} from '../../src/classify/attachment-budget.js'

const MB = 1024 * 1024
const pdf = (mb: number) => ({ contentType: 'application/pdf', sizeBytes: mb * MB })
const docx = (mb: number) => ({
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: mb * MB,
})

/**
 * 要件 §6: Anthropic のリクエスト上限 32MB。個々が上限内でも合計で超え得るので、
 * 送る前に弾く。
 */
describe('exceededAttachmentTotalBytes', () => {
  it('上限は 20MB（base64 で約 26.7MB。32MB に 5MB 強の余裕を残す）', () => {
    expect(ATTACHMENT_TOTAL_LIMIT_BYTES).toBe(20 * MB)
  })

  it('合計が上限以内なら null', () => {
    expect(exceededAttachmentTotalBytes([])).toBeNull()
    expect(exceededAttachmentTotalBytes([pdf(3), pdf(3), pdf(3)])).toBeNull()
    // ちょうど上限は通す（超過のみ弾く）
    expect(exceededAttachmentTotalBytes([pdf(20)])).toBeNull()
  })

  it('1件ごとの上限（8MB）を全て満たしていても合計超過なら弾く', () => {
    // 実運用の要綱 PDF は 0.5〜3MB だが、8MB 級を3件選べば合計 24MB。
    const total = exceededAttachmentTotalBytes([pdf(8), pdf(8), pdf(8)])
    expect(total).toBe(24 * MB)
  })

  it('PDF 以外は合計に数えない（リクエストを占めるのは base64 の document ブロック）', () => {
    expect(exceededAttachmentTotalBytes([pdf(19), docx(19)])).toBeNull()
  })
})
