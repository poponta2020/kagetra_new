/**
 * 選択した PDF 添付の**合計**サイズ予算（要件 §6）。
 *
 * 1件ごとの `MAIL_WORKER_PDF_SIZE_LIMIT_KB` とは別物。個々が上限内でも、複数
 * 選べば合計は Anthropic Messages API のリクエスト上限 **32MB** を超え得る
 * （PDF は base64 で約 4/3 に膨らむので、生 24MB でもう 32MB に届く）。超えた
 * リクエストは 413 `request_too_large` で確実に失敗するため、送る前に弾く。
 *
 * **依存ゼロの leaf モジュールにしてある。** 同じ判定を Server Action・選択
 * ダイアログ（client component）・classifier の3箇所が共有するが、`config.ts`
 * は `node:url` / `dotenv` を値 import しており、client バンドルに引き込むと
 * 壊れる（既知の罠）。ここには import を一切置かないこと。
 */

/**
 * 20MB → base64 で約 26.7MB。system プロンプト・tool schema・本文・JSON
 * オーバーヘッドの余裕として 5MB 強を残す。実運用の要綱 PDF は 0.5〜3MB
 * （実測。docs/features/mail-ai-extract-refinements/token-baseline.md）なので、
 * 通常の選択がこの上限に触ることはない。
 *
 * env にしていないのは、これが運用の好みではなく**外部 API の物理上限から
 * 導かれる値**だから。緩めても 413 になるだけで得がない。
 */
export const ATTACHMENT_TOTAL_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * PDF 添付の合計サイズが {@link ATTACHMENT_TOTAL_LIMIT_BYTES} を超えていないか
 * 判定する。超過していれば合計バイト数を、収まっていれば `null` を返す。
 *
 * PDF だけを数えるのは、リクエスト本体を占めるのが base64 の document ブロック
 * だから（テキスト抽出済み添付は抽出後の文字列で、桁が2つ違う）。1件ごとの
 * ガードが `application/pdf` だけを見ているのとも揃う。
 */
export function exceededAttachmentTotalBytes(
  attachments: readonly { contentType: string; sizeBytes: number }[],
): number | null {
  const total = attachments
    .filter((a) => a.contentType === 'application/pdf')
    .reduce((sum, a) => sum + a.sizeBytes, 0)
  return total > ATTACHMENT_TOTAL_LIMIT_BYTES ? total : null
}
