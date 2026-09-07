import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { mailBodyShareTokens } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * メール本文の公開 URL トークン (mail-body-as-image 2026-09 改修)。
 *
 * LINE へ送る本文カードのタップ先 `/mail-share/[token]` を発行する。既存の
 * 添付トークン (`attachment-image-render.ts` の `getOrCreateShareToken`) と
 * 同条件 (32 文字 URL-safe random・60 日 TTL・期限内は再利用) だが、この
 * モジュールは **DB にしか依存しない**。sharp / libreoffice を持ち込む
 * `attachment-image-render.ts` へ本文経路を相乗りさせない（本文配信から
 * 重依存が外れたのが本改修の効果の一つ）。
 */

/** 添付トークンと同じ 60 日。LINE のトーク履歴に URL が残る期間の上限。 */
export const MAIL_BODY_SHARE_TTL_DAYS = 60

/**
 * メール 1 通に対する公開トークンを発行する（期限内なら既存を再利用）。
 *
 * SQL の動作（`getOrCreateShareToken` と同一。並行配信で 23505 に倒れて
 * broadcast 全体を failed にしないため INSERT ... ON CONFLICT の 1 文）:
 *   - 行が無い → INSERT (token / expires_at / access_count=0 で着地)
 *   - 行があって期限内 → 既存値を維持（URL が変わらない）
 *   - 行があって期限切れ → token / expires_at / access_count=0 を更新
 */
export async function getOrCreateMailBodyShareToken(
  db: typeof appDb,
  mailMessageId: number,
  options: { ttlDays?: number; now?: Date } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttlDays = options.ttlDays ?? MAIL_BODY_SHARE_TTL_DAYS
  const now = options.now ?? new Date()
  const candidateToken = randomBytes(24).toString('base64url')
  const candidateExpiresAt = new Date(now.getTime() + ttlDays * 86_400_000)

  const inserted = await db
    .insert(mailBodyShareTokens)
    .values({
      mailMessageId,
      token: candidateToken,
      expiresAt: candidateExpiresAt,
    })
    .onConflictDoUpdate({
      target: mailBodyShareTokens.mailMessageId,
      set: {
        token: sql`CASE WHEN ${mailBodyShareTokens.expiresAt} > now() THEN ${mailBodyShareTokens.token} ELSE EXCLUDED.token END`,
        expiresAt: sql`CASE WHEN ${mailBodyShareTokens.expiresAt} > now() THEN ${mailBodyShareTokens.expiresAt} ELSE EXCLUDED.expires_at END`,
        accessCount: sql`CASE WHEN ${mailBodyShareTokens.expiresAt} > now() THEN ${mailBodyShareTokens.accessCount} ELSE 0 END`,
      },
    })
    .returning({
      token: mailBodyShareTokens.token,
      expiresAt: mailBodyShareTokens.expiresAt,
    })

  const row = inserted[0]
  if (!row) {
    throw new Error('getOrCreateMailBodyShareToken: upsert returned no row')
  }
  return { token: row.token, expiresAt: row.expiresAt }
}

/** 公開ページの URL。`baseUrl` は末尾スラッシュ無しの https origin。 */
export function mailBodyShareUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/mail-share/${token}`
}
