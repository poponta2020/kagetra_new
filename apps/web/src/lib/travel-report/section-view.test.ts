import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { travelReportBatches, travelReportDocuments } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup } from '@/test-utils/seed'
import { loadTravelReportSectionData } from './section-view'

/**
 * S5「遠征届」セクションの作成履歴（requirements R13・Codex R1 #10）。
 *
 * `travel_report_batches.notify_error` / `notified_at` が永続化されていても、
 * 従来の `loadHistory` は取得しておらず表示 DTO にも無かった（通知失敗が
 * S5 に出ない）。ここでは history に両方の値が乗ることを固定する。
 */

afterAll(async () => {
  await closeTestDb()
})

async function seedBatchWithDocument(
  entryGroupId: number,
  createdBy: string,
  overrides: { notifyError?: string | null; notifiedAt?: Date | null } = {},
) {
  const [batch] = await testDb
    .insert(travelReportBatches)
    .values({
      entryGroupId,
      createdBy,
      notifyError: overrides.notifyError ?? null,
      notifiedAt: overrides.notifiedAt ?? null,
    })
    .returning()
  if (!batch) throw new Error('failed to create batch')
  await testDb.insert(travelReportDocuments).values({
    batchId: batch.id,
    eventIds: [],
    filename: 'test.docx',
    docx: Buffer.from('x'),
    header: {},
    memberCount: 0,
  })
  return batch
}

describe('loadTravelReportSectionData: 作成履歴の通知状態', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('notify_error のある batch は history に notifyError が乗る（Codex R1 #10）', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const admin = await createAdmin()
    await seedBatchWithDocument(entryGroupId, admin.id, { notifyError: 'LINE がエラーを返しました' })

    const data = await loadTravelReportSectionData(entryGroupId, false, true)

    expect(data.history).toHaveLength(1)
    expect(data.history?.[0]?.notifyError).toBe('LINE がエラーを返しました')
  })

  it('通知成功（notified_at あり・notify_error 無し）なら notifyError は null', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const admin = await createAdmin()
    await seedBatchWithDocument(entryGroupId, admin.id, { notifiedAt: new Date() })

    const data = await loadTravelReportSectionData(entryGroupId, false, true)

    expect(data.history?.[0]?.notifyError).toBeNull()
    expect(data.history?.[0]?.notifiedAt).not.toBeNull()
  })

  it('canOperate=false なら history 自体を組み立てない（電話番号入りの作成物へ近づけない）', async () => {
    const { id: entryGroupId } = await createEntryGroup()
    const admin = await createAdmin()
    await seedBatchWithDocument(entryGroupId, admin.id, { notifyError: 'エラー' })

    const data = await loadTravelReportSectionData(entryGroupId, false, false)

    expect(data.history).toBeUndefined()
  })
})
