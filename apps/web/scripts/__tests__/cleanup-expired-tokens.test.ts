import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  attachmentShareTokens,
  mailAttachments,
  mailBodyShareTokens,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createMailMessage } from '@/test-utils/seed'
import { cleanupExpiredTokens } from '../cleanup-expired-tokens'

afterAll(async () => {
  await closeTestDb()
})

beforeEach(async () => {
  await truncateAll()
})

const NOW = new Date('2026-09-07T00:00:00Z')
/** 期限 +7 日の猶予を跨いだ行 (削除対象)。 */
const LONG_EXPIRED = new Date(NOW.getTime() - 8 * 86_400_000)
/** 期限切れだが猶予内 (残す)。 */
const RECENTLY_EXPIRED = new Date(NOW.getTime() - 2 * 86_400_000)
/** まだ有効 (残す)。 */
const VALID = new Date(NOW.getTime() + 30 * 86_400_000)

async function seedAttachmentToken(expiresAt: Date, token: string) {
  const mail = await createMailMessage({})
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mail.id,
      filename: 'roster.xlsx',
      contentType: 'application/octet-stream',
      sizeBytes: 1,
      data: Buffer.from('x'),
    })
    .returning({ id: mailAttachments.id })
  await testDb.insert(attachmentShareTokens).values({
    mailAttachmentId: attachment!.id,
    token,
    expiresAt,
  })
}

async function seedMailBodyToken(expiresAt: Date, token: string) {
  const mail = await createMailMessage({})
  await testDb.insert(mailBodyShareTokens).values({
    mailMessageId: mail.id,
    token,
    expiresAt,
  })
}

describe('cleanupExpiredTokens', () => {
  it('AC-12: mail_body_share_tokens も期限 +7 日の猶予で削除する', async () => {
    await seedMailBodyToken(LONG_EXPIRED, 'body-expired')
    await seedMailBodyToken(RECENTLY_EXPIRED, 'body-grace')
    await seedMailBodyToken(VALID, 'body-valid')

    const result = await cleanupExpiredTokens(testDb, { now: NOW })

    expect(result.deletedCount).toBe(1)
    const remaining = await testDb.select().from(mailBodyShareTokens)
    expect(remaining.map((r) => r.token).sort()).toEqual(['body-grace', 'body-valid'])
  })

  it('添付トークンの掃除は従来どおり（両テーブルの合計を返す）', async () => {
    await seedAttachmentToken(LONG_EXPIRED, 'att-expired')
    await seedAttachmentToken(VALID, 'att-valid')
    await seedMailBodyToken(LONG_EXPIRED, 'body-expired')

    const result = await cleanupExpiredTokens(testDb, { now: NOW })

    expect(result.deletedCount).toBe(2)
    const attachments = await testDb.select().from(attachmentShareTokens)
    expect(attachments.map((r) => r.token)).toEqual(['att-valid'])
    const bodies = await testDb.select().from(mailBodyShareTokens)
    expect(bodies).toHaveLength(0)
  })

  it('--dry-run は両テーブルを数えるだけで削除しない', async () => {
    await seedAttachmentToken(LONG_EXPIRED, 'att-expired')
    await seedMailBodyToken(LONG_EXPIRED, 'body-expired')

    const result = await cleanupExpiredTokens(testDb, { now: NOW, dryRun: true })

    expect(result.deletedCount).toBe(2)
    expect(await testDb.select().from(attachmentShareTokens)).toHaveLength(1)
    expect(await testDb.select().from(mailBodyShareTokens)).toHaveLength(1)
  })
})
