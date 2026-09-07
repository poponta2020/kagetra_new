import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mailBodyShareTokens } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createMailMessage } from '@/test-utils/seed'
import {
  MAIL_BODY_SHARE_TTL_DAYS,
  getOrCreateMailBodyShareToken,
  mailBodyShareUrl,
} from './mail-body-share'

afterAll(async () => {
  await closeTestDb()
})

beforeEach(async () => {
  await truncateAll()
})

describe('getOrCreateMailBodyShareToken', () => {
  it('AC-11: 新規発行は URL-safe base64 32 文字・期限は 60 日後', async () => {
    const mail = await createMailMessage({})
    const now = new Date('2026-09-07T00:00:00Z')

    const { token, expiresAt } = await getOrCreateMailBodyShareToken(db, mail.id, {
      now,
    })

    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(MAIL_BODY_SHARE_TTL_DAYS).toBe(60)
    expect(expiresAt.getTime() - now.getTime()).toBe(60 * 86_400_000)
  })

  it('AC-9: 期限内の再配信では同じ token / 期限が再利用される', async () => {
    const mail = await createMailMessage({})

    const first = await getOrCreateMailBodyShareToken(db, mail.id)
    const second = await getOrCreateMailBodyShareToken(db, mail.id)

    expect(second.token).toBe(first.token)
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime())
    const rows = await testDb
      .select()
      .from(mailBodyShareTokens)
      .where(eq(mailBodyShareTokens.mailMessageId, mail.id))
    expect(rows).toHaveLength(1)
  })

  it('AC-10: 期限切れの行は token・期限が再生成され access_count が 0 に戻る', async () => {
    const mail = await createMailMessage({})
    const first = await getOrCreateMailBodyShareToken(db, mail.id)
    // 期限切れ + アクセス実績ありの状態を作る
    await testDb
      .update(mailBodyShareTokens)
      .set({ expiresAt: new Date(Date.now() - 86_400_000), accessCount: 5 })
      .where(eq(mailBodyShareTokens.mailMessageId, mail.id))

    const second = await getOrCreateMailBodyShareToken(db, mail.id)

    expect(second.token).not.toBe(first.token)
    expect(second.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const rows = await testDb
      .select()
      .from(mailBodyShareTokens)
      .where(eq(mailBodyShareTokens.mailMessageId, mail.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.accessCount).toBe(0)
  })

  it('メールごとに別のトークンを発行する', async () => {
    const a = await createMailMessage({})
    const b = await createMailMessage({})

    const tokenA = await getOrCreateMailBodyShareToken(db, a.id)
    const tokenB = await getOrCreateMailBodyShareToken(db, b.id)

    expect(tokenA.token).not.toBe(tokenB.token)
  })
})

describe('mailBodyShareUrl', () => {
  it('公開ページのパス形式は /mail-share/<token>', () => {
    expect(mailBodyShareUrl('abc123', 'https://example.com')).toBe(
      'https://example.com/mail-share/abc123',
    )
  })
})
