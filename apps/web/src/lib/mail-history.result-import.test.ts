import type { InferInsertModel } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resultDrafts } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createMailMessage } from '@/test-utils/seed'
import { loadResultImportRows } from './mail-history.result-import'

/**
 * mail-history.result-import.ts — H0（試合結果として取り込み）の結合テスト。
 * requirements.md §3.4 H0 / AC-32。
 */

type NewResultDraft = InferInsertModel<typeof resultDrafts>

/** `result_drafts` を1件作る。`messageId` は UNIQUE なので毎回別メールが必要。 */
async function createResultDraft(overrides: Partial<NewResultDraft> & { messageId: number }) {
  const [draft] = await testDb
    .insert(resultDrafts)
    .values({
      status: 'pending_review',
      extractedPayload: {},
      parserVersion: 'test-1.0',
      ...overrides,
    })
    .returning()
  if (!draft) throw new Error('Failed to insert test result draft')
  return draft
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('loadResultImportRows', () => {
  it('AC-32: status=approved を持つメールに approved_at 日付＋「試合結果として取り込み」の行が出る。大会名・eventLink は出さない', async () => {
    const mail = await createMailMessage({})
    const approvedAt = new Date('2026-07-21T00:00:00Z')
    await createResultDraft({ messageId: mail.id, status: 'approved', approvedAt })

    const rows = await loadResultImportRows(testDb, [mail.id])
    const row = rows.get(mail.id)

    expect(row).toBeDefined()
    expect(row!.kind).toBe('result_import')
    expect(row!.at).toEqual(approvedAt)
    expect(row!.segments).toEqual([{ type: 'text', value: '試合結果として取り込み' }])
    expect(row!.segments.some((s) => s.type === 'eventLink')).toBe(false)
    expect(row!.detail).toBeNull()
    expect(row!.note).toBeNull()
  })

  it('approved 以外のドラフト（pending_review / rejected / parse_failed）では行を出さない', async () => {
    const pendingMail = await createMailMessage({})
    await createResultDraft({ messageId: pendingMail.id, status: 'pending_review' })

    const rejectedMail = await createMailMessage({})
    await createResultDraft({
      messageId: rejectedMail.id,
      status: 'rejected',
      rejectedAt: new Date(),
    })

    const parseFailedMail = await createMailMessage({})
    await createResultDraft({ messageId: parseFailedMail.id, status: 'parse_failed', parseError: 'boom' })

    const rows = await loadResultImportRows(testDb, [
      pendingMail.id,
      rejectedMail.id,
      parseFailedMail.id,
    ])

    expect(rows.size).toBe(0)
  })

  it('result_drafts を持たないメールは行を出さない', async () => {
    const mail = await createMailMessage({})
    const rows = await loadResultImportRows(testDb, [mail.id])
    expect(rows.has(mail.id)).toBe(false)
  })

  it('mailIds 空配列で DB を叩かず空 Map', async () => {
    const selectSpy = vi.spyOn(testDb, 'select')
    const rows = await loadResultImportRows(testDb, [])
    expect(rows.size).toBe(0)
    expect(selectSpy).not.toHaveBeenCalled()
    selectSpy.mockRestore()
  })
})
