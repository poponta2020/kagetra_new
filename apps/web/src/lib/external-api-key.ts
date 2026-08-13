import { timingSafeEqual } from 'node:crypto'

/**
 * 外部連携 API（`/api/external/**`）の静的 API キー検証。
 *
 * `Authorization: Bearer <key>` を環境変数 `EXTERNAL_ENTRANTS_API_KEY` と
 * 突き合わせる。実装は `line-webhook-handler.ts` の `verifyLineSignature` と
 * 同形（`timingSafeEqual` は同長バッファ必須なので長さ不一致は early return →
 * 比較本体は try/catch 内）。server-only の lib なので `node:crypto` を使える。
 *
 * fail-closed の要:
 * - env が**未設定・空文字なら比較せず常に false** —— 空文字同士の一致
 *   （`'' === ''`）で素通りする罠を塞ぐ。キー未設定のままコードだけ先に本番へ
 *   出ても常に 401 なので、デプロイ順序の制約が生じない。
 * - `process.env` は呼び出しごとに読む（モジュールトップで読むとビルド時に
 *   固定される。本番は systemd EnvironmentFile の実行時読みが前提）。
 *
 * キーを URL クエリで渡すことは契約で禁止（nginx access log に残る。
 * `docs/spec/external-api.md`）。受け口は Authorization ヘッダのみ。
 */
export function verifyExternalApiKey(
  authorizationHeader: string | null,
): boolean {
  const expected = process.env.EXTERNAL_ENTRANTS_API_KEY
  if (!expected) return false
  if (!authorizationHeader?.startsWith('Bearer ')) return false
  const provided = authorizationHeader.slice('Bearer '.length)
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}
