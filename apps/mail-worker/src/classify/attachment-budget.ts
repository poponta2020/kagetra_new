/**
 * 選択した PDF 添付の**合計**サイズ予算（要件 §6）。
 *
 * 1件ごとの `MAIL_WORKER_PDF_SIZE_LIMIT_KB` とは別物。個々が上限内でも、複数
 * 選べば合計は Anthropic Messages API のリクエスト上限 **32MB** を超え得る。
 * 超えたリクエストは 413 `request_too_large` で確実に失敗するため、送る前に弾く。
 *
 * **依存ゼロの leaf モジュールにしてある。** 同じ判定を Server Action・選択
 * ダイアログ（client component）・classifier の3箇所が共有するが、`config.ts`
 * は `node:url` / `dotenv` を値 import しており、client バンドルに引き込むと
 * 壊れる（既知の罠）。ここには import を一切置かないこと。
 */

/** Anthropic Messages API の 1 リクエスト上限。 */
const ANTHROPIC_REQUEST_LIMIT_BYTES = 32 * 1024 * 1024

/**
 * 添付以外がリクエストで占める分の予約枠。**判定を「生 PDF バイト」ではなく
 * 「実際に送られる HTTP リクエストのサイズ」に紐付けるための項**である。
 *
 * 内訳（実測ベース）: system プロンプト 約20KB、tool schema（`record_extraction`
 * の JSON Schema）約5KB、メール本文 数KB、JSON の構造・エスケープ 数KB。
 * これに加えて**テキスト抽出済み添付**（DOCX/DOC の抽出テキスト）が本文と同じ
 * text ブロックに載る —— これは桁が読みにくいので、6MiB という実測の数百倍の
 * 枠を取って丸ごと吸収する。
 */
const NON_ATTACHMENT_RESERVE_BYTES = 6 * 1024 * 1024

/** base64 化後の PDF に使える上限（= 32MiB − 予約枠 = 26MiB）。 */
const ENCODED_PDF_BUDGET_BYTES =
  ANTHROPIC_REQUEST_LIMIT_BYTES - NON_ATTACHMENT_RESERVE_BYTES

/** base64 は 3 バイトを 4 文字に変換する（パディング込みで切り上げ）。 */
export function base64EncodedBytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4
}

/**
 * 選択できる PDF の**生バイト**合計の上限。UI・エラーメッセージが人間に見せる
 * 値で、判定そのものは base64 化後のサイズで行う（{@link
 * exceededAttachmentTotalBytes}）。
 *
 * 26MiB の base64 枠を生バイトへ戻して約 19.5MiB。実運用の要綱 PDF は 0.5〜3MB
 * （実測。docs/features/mail-ai-extract-refinements/token-baseline.md）なので、
 * 通常の選択がこの上限に触ることはない。
 *
 * env にしていないのは、これが運用の好みではなく**外部 API の物理上限から
 * 導かれる値**だから。緩めても 413 になるだけで得がない。
 */
export const ATTACHMENT_TOTAL_LIMIT_BYTES = Math.floor(
  (ENCODED_PDF_BUDGET_BYTES * 3) / 4,
)

/**
 * PDF 添付の合計が予算を超えていないか判定する。超過していれば**生バイトの**
 * 合計を、収まっていれば `null` を返す（呼び出し側がそのまま人間に見せられる
 * 単位に揃えてある）。
 *
 * 判定は base64 化後のサイズで行う —— リクエストに載るのは base64 文字列であり、
 * 生バイトで比べると約 4/3 の差を取りこぼす。
 *
 * PDF だけを数えるのは、リクエスト本体を占めるのが base64 の document ブロック
 * だから。テキスト抽出済み添付・本文・プロンプトは
 * {@link NON_ATTACHMENT_RESERVE_BYTES} の予約枠でまとめて確保している。1件ごとの
 * ガードが `application/pdf` だけを見ているのとも揃う。
 */
export function exceededAttachmentTotalBytes(
  attachments: readonly { contentType: string; sizeBytes: number }[],
): number | null {
  const rawTotal = attachments
    .filter((a) => a.contentType === 'application/pdf')
    .reduce((sum, a) => sum + a.sizeBytes, 0)
  return base64EncodedBytes(rawTotal) > ENCODED_PDF_BUDGET_BYTES ? rawTotal : null
}
