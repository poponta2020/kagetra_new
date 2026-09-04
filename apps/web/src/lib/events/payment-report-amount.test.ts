import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { entryGroupPaymentNotices } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import { resolvePaymentReportAmount } from './payment-report-amount'

/**
 * payment-receipt-broadcast タスク3: 「景虎上の想定金額」の決定（要件 §3.2.3-9〜11）。
 * DB を使うテスト（`payment-notice-context.test.ts` と同じ流儀）。
 */
describe('resolvePaymentReportAmount', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('振込連絡が送信済みなら total_jpy をそのまま使い、未算入注記は常に0（AC-8/AC-11）', async () => {
    const group = await createEntryGroup()
    // eligibleGrades: null が必須 — 非null だと inArray(users.grade, …) で
    // grade IS NULL の行が母集団から落ち、その場集計側でも unknownGradeCount が
    // 0 のままになって「常に0にしている」の検証にならない（advisor 指摘）。
    const event = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: null,
      paymentType: 'advance',
    })
    // その場集計をそのまま使うと unknownGradeCount が非0になる状況を仕込み、
    // それでも payment_notice 経路では 0 になることを検証する。
    const unknown = await createUser({ name: 'pra-notice-unknown', grade: null })
    await createEventAttendance({ eventId: event.id, userId: unknown.id })
    await testDb.insert(entryGroupPaymentNotices).values({
      entryGroupId: group.id,
      gradeCounts: { A: 5 },
      totalJpy: 12_500,
      lastSentAt: new Date('2026-07-20T00:00:00Z'),
    })

    const result = await resolvePaymentReportAmount(testDb, group.id)
    // 12,500円は振込連絡の保存値でしか出ない（その場集計はこの母集団だと 0円）。
    expect(result).toEqual({ amountJpy: 12_500, source: 'payment_notice', unknownGradeCount: 0 })
  })

  it('振込連絡が未送信（人数だけ保存・lastSentAt=null）ならその場集計を使う', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: null,
      paymentType: 'advance',
    })
    // 人数だけ保存され送信されていない振込連絡（＝優先順1の対象外）。
    await testDb.insert(entryGroupPaymentNotices).values({
      entryGroupId: group.id,
      gradeCounts: { A: 99 },
      totalJpy: 999_999,
      lastSentAt: null,
    })
    const a1 = await createUser({ name: 'pra-a1', grade: 'A' })
    const a2 = await createUser({ name: 'pra-a2', grade: 'A' })
    for (const u of [a1, a2]) {
      await createEventAttendance({ eventId: event.id, userId: u.id })
    }

    const result = await resolvePaymentReportAmount(testDb, group.id)
    // 送信済みの振込連絡が無い以上、未送信の保存値（999,999）ではなく
    // tallyEntryFeesForGroup の実集計（A級2名×2,500円）を使う。
    expect(result).toEqual({ amountJpy: 5_000, source: 'tally', unknownGradeCount: 0 })
  })

  it('振込連絡が無いグループでもその場集計を使う（AC-9）', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: null,
      paymentType: 'advance',
    })
    const b1 = await createUser({ name: 'pra-b1', grade: 'B' })
    await createEventAttendance({ eventId: event.id, userId: b1.id })

    const result = await resolvePaymentReportAmount(testDb, group.id)
    expect(result).toEqual({ amountJpy: 2_500, source: 'tally', unknownGradeCount: 0 })
  })

  it('級未設定者がいるその場集計では unknownGradeCount が非0になる（AC-11）', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: null,
      paymentType: 'advance',
    })
    const known = await createUser({ name: 'pra-known', grade: 'A' })
    const unknown = await createUser({ name: 'pra-unknown', grade: null })
    await createEventAttendance({ eventId: event.id, userId: known.id })
    await createEventAttendance({ eventId: event.id, userId: unknown.id })

    const result = await resolvePaymentReportAmount(testDb, group.id)
    expect(result).toEqual({ amountJpy: 2_500, source: 'tally', unknownGradeCount: 1 })
  })

  it('total_jpy が算出不能（対象イベントなし）なら source=none で amountJpy=null（AC-10）', async () => {
    const group = await createEntryGroup()
    // official=false / kind=team 等、人数×単価で価格付けできないイベントのみ。
    await createEvent({
      entryGroupId: group.id,
      official: false,
      kind: 'individual',
      paymentType: 'advance',
    })

    const result = await resolvePaymentReportAmount(testDb, group.id)
    expect(result).toEqual({ amountJpy: null, source: 'none', unknownGradeCount: 0 })
  })
})
