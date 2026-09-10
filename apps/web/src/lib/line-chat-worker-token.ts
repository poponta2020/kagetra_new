import { timingSafeEqual } from 'node:crypto'

/**
 * `/api/line-chat-worker/**`（match-tracker `line-chat-worker` 常駐ワーカーからの
 * ポーリング）の静的トークン検証。`X-Service-Token` ヘッダを環境変数
 * `LINE_CHAT_WORKER_TOKEN`（kagetra 専用・match-tracker の `EXTERNAL_ENTRANTS_API_KEY`
 * とは別物・共有しない）と突き合わせる。
 *
 * `apps/web/src/lib/external-api-key.ts` の `verifyExternalApiKey` と同形
 * （`timingSafeEqual` は同長バッファ必須なので長さ不一致は early return）。
 * fail-closed の要:
 * - env が**未設定・空文字なら比較せず常に不一致** —— 空文字同士の一致で
 *   素通りする罠を塞ぐ。
 * - `process.env` は呼び出しごとに読む（ビルド時に固定しない。本番は systemd
 *   EnvironmentFile の実行時読みが前提）。
 *
 * `verifyExternalApiKey` と違い、こちらは呼び出し元（route）が **401（トークン
 * 無し）と 403（トークン不正）を区別する**必要がある（requirements R12・AC-21）ので
 * 真偽値ではなく 3 値の判定結果を返す。
 */
export type LineChatWorkerTokenVerification = 'ok' | 'missing' | 'invalid'

export function verifyLineChatWorkerToken(
  serviceTokenHeader: string | null,
): LineChatWorkerTokenVerification {
  // ヘッダ欠落・空文字は「トークン無し」（401）。env の状態に関わらず先に判定する。
  if (!serviceTokenHeader) return 'missing'

  const expected = process.env.LINE_CHAT_WORKER_TOKEN
  // env 未設定なら、ヘッダが何であれ「不正」（403）扱い（fail-closed。
  // トークン自体は送られてきているので 401 ではなく 403 が実態に合う）。
  if (!expected) return 'invalid'

  if (serviceTokenHeader.length !== expected.length) return 'invalid'
  try {
    return timingSafeEqual(Buffer.from(serviceTokenHeader), Buffer.from(expected))
      ? 'ok'
      : 'invalid'
  } catch {
    return 'invalid'
  }
}
