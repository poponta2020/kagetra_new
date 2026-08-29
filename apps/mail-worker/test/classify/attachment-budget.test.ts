import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_TOTAL_LIMIT_BYTES,
  base64EncodedBytes,
  exceededAttachmentTotalBytes,
  exceededRequestBudgetBytes,
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

  it('上限は 32MiB から予約枠 1MiB を引いた base64 枠（31MiB）を生バイトへ戻した値', () => {
    // 31MiB の base64 枠 → 生バイトは 3/4 の約 23.25MiB。
    expect(ATTACHMENT_TOTAL_LIMIT_BYTES).toBe(Math.floor((31 * MiB * 3) / 4))
    // 実際に送られるサイズが 32MiB を超えないことが本質。
    const encoded = base64EncodedBytes(ATTACHMENT_TOTAL_LIMIT_BYTES)
    expect(encoded + MiB).toBeLessThanOrEqual(32 * MiB)
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

  it('1件ずつは注意の目安（8000KB）程度でも、積み上げれば合計超過で弾く', () => {
    // 各 8.5MiB。単体では「大きめ」の注意が出るだけで送れるが、3 件で
    // 25.5MiB となり 23.25MiB の合計予算を超える。
    const big = 8.5 * MiB
    expect(exceededAttachmentTotalBytes([pdf(big), pdf(big), pdf(big)])).toBe(3 * big)
  })

  it('生バイトではなく base64 化後で判定する（4/3 の差を取りこぼさない）', () => {
    // 生 24MiB は「32MiB 以内」に見えるが、base64 で 32MiB になり、
    // 予約枠 1MiB を足すと 32MiB を超える。
    expect(exceededAttachmentTotalBytes([pdf(24 * MiB)])).toBe(24 * MiB)
  })

  it('PDF 以外は合計に数えない（予約枠でまとめて確保している）', () => {
    expect(exceededAttachmentTotalBytes([pdf(19 * MiB), docx(19 * MiB)])).toBeNull()
  })
})

/**
 * 送信直前の最終判定。事前チェック（PDF 合計）は非 PDF 部分を予約枠で見積もる
 * ため、その仮定が崩れる入力では通り抜ける。実測はここで確定させる。
 */
describe('exceededRequestBudgetBytes', () => {
  it('32MiB 以内なら null（封筒ぶんの余裕を引いた上で判定する）', () => {
    expect(exceededRequestBudgetBytes(0)).toBeNull()
    expect(exceededRequestBudgetBytes(30 * MiB)).toBeNull()
  })

  it('封筒ぶんを足して 32MiB を超えたら合計バイト数を返す', () => {
    const over = exceededRequestBudgetBytes(32 * MiB)
    expect(over).not.toBeNull()
    expect(over!).toBeGreaterThan(32 * MiB)
  })

  it('PDF 合計が事前チェックを通っても、非 PDF が予約枠を食えば最終判定で弾ける', () => {
    // PDF 上限ぎりぎり（事前チェックは通る）。
    const pdfRaw = ATTACHMENT_TOTAL_LIMIT_BYTES
    expect(exceededAttachmentTotalBytes([pdf(pdfRaw)])).toBeNull()
    // その base64 に、予約枠 1MiB を超える本文・抽出テキストが乗るケース。
    const assembled = base64EncodedBytes(pdfRaw) + 2 * MiB
    expect(exceededRequestBudgetBytes(assembled)).not.toBeNull()
  })
})
