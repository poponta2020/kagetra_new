import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEntryGroup } from '@/test-utils/seed'

/**
 * payment-receipt-broadcast タスク1: 新規2テーブルの FK 挙動（要件 §3.2.5 / AC-19）。
 *
 * 証憑は「送信1回ぶんの記録」にぶら下がり、記録はグループにぶら下がる。どちらの
 * ON DELETE も CASCADE なので、グループを消せば報告も証憑もまとめて消える。
 * 逆に **未払に戻す・報告を消さない限り記録は残る**（AC-19 の DB 側の裏付け）。
 *
 * ★`packages/shared` には DB を張るテスト基盤が無い（vitest.config.ts は
 * `environment: 'node'` の純関数スモークのみ）ため、DB を要するこのテストは
 * apps/web 側に置く。
 */

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47])

async function insertReport(entryGroupId: number, createdBy: string | null = null) {
  const [row] = await testDb
    .insert(entryGroupPaymentReports)
    .values({
      entryGroupId,
      eventIds: [1, 2],
      amountJpy: 12500,
      amountSource: 'payment_notice',
      messageText: '参加費の振り込みが完了しました。',
      receiptCount: 1,
      status: 'sent',
      createdBy,
    })
    .returning()
  if (!row) throw new Error('failed to insert payment report')
  return row
}

async function insertReceipt(reportId: number, token: string) {
  const [row] = await testDb
    .insert(entryGroupPaymentReceipts)
    .values({
      reportId,
      sortOrder: 0,
      filename: 'receipt.jpg',
      contentType: 'image/jpeg',
      data: PNG_STUB,
      byteSize: PNG_STUB.byteLength,
      width: 100,
      height: 200,
      previewData: PNG_STUB,
      token,
    })
    .returning()
  if (!row) throw new Error('failed to insert payment receipt')
  return row
}

describe('payment report / receipt schema', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('報告を消すと証憑も消える（report_id ON DELETE CASCADE）', async () => {
    const group = await createEntryGroup()
    const report = await insertReport(group.id)
    await insertReceipt(report.id, 'tok-report-cascade-0001')

    await testDb.delete(entryGroupPaymentReports).where(eq(entryGroupPaymentReports.id, report.id))

    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(0)
  })

  it('グループを消すと報告も証憑も消える（entry_group_id ON DELETE CASCADE）', async () => {
    const group = await createEntryGroup()
    const report = await insertReport(group.id)
    await insertReceipt(report.id, 'tok-group-cascade-0001')

    await testDb.delete(entryGroups).where(eq(entryGroups.id, group.id))

    expect(await testDb.select().from(entryGroupPaymentReports)).toHaveLength(0)
    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(0)
  })

  it('実行者を消しても報告は残る（created_by ON DELETE SET NULL）', async () => {
    const group = await createEntryGroup()
    const admin = await createAdmin()
    const report = await insertReport(group.id, admin.id)

    await testDb.delete(users).where(eq(users.id, admin.id))

    const rows = await testDb
      .select()
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.id, report.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.createdBy).toBeNull()
  })

  it('token は UNIQUE（同じトークンを2枚に割り当てられない）', async () => {
    const group = await createEntryGroup()
    const report = await insertReport(group.id)
    await insertReceipt(report.id, 'tok-unique-0001')

    await expect(insertReceipt(report.id, 'tok-unique-0001')).rejects.toThrow()
  })
})
