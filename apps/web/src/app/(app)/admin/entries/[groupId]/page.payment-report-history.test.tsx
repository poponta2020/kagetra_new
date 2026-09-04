import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { eq } from 'drizzle-orm'
import {
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
  events,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * payment-receipt-broadcast タスク9: 支払報告の履歴（AC-17 / AC-18 / AC-19）。
 * 再送そのものの挙動は `actions.payment-resend.test.ts` が持つ。ここが持つのは
 * **画面に何が並ぶか**だけ。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/auth', () => mockAuthModule())
vi.mock('@/components/events/EventRelatedMails', () => ({
  EventRelatedMails: () => null,
}))

const { default: EntryGroupPage } = await import('./page')

function renderPage(groupId: number) {
  return EntryGroupPage({ params: Promise.resolve({ groupId: String(groupId) }) })
}

async function seedReport(
  entryGroupId: number,
  overrides: Partial<typeof entryGroupPaymentReports.$inferInsert> = {},
  tokens: string[] = [],
) {
  const [report] = await testDb
    .insert(entryGroupPaymentReports)
    .values({
      entryGroupId,
      eventIds: [],
      amountJpy: 12500,
      amountSource: 'tally',
      messageText: '参加費の振り込みが完了しました。',
      receiptCount: tokens.length,
      status: 'sent',
      ...overrides,
    })
    .returning()
  for (const [index, token] of tokens.entries()) {
    await testDb.insert(entryGroupPaymentReceipts).values({
      reportId: report!.id,
      sortOrder: index,
      filename: `m${index}.jpg`,
      contentType: 'image/jpeg',
      data: Buffer.from([1, 2, 3]),
      byteSize: 3,
      width: 10,
      height: 10,
      previewData: Buffer.from([1, 2, 3]),
      token,
    })
  }
  return report!
}

async function seedGroupWithPaidDay() {
  const group = await createEntryGroup()
  const day = await createEvent({
    entryGroupId: group.id,
    eventDate: '2030-09-06',
    entryStatus: 'applied',
    paymentType: 'advance',
    paymentStatus: 'paid',
  })
  return { group, day }
}

describe('/admin/entries/[groupId] — 支払報告の履歴', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('想定額・枚数・状態・実行者が並ぶ（AC-17）', async () => {
    const admin = await createAdmin({ name: 'prh-admin-1' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedGroupWithPaidDay()
    await seedReport(group.id, { createdBy: admin.id }, ['tok-history-000000001'])

    render(await renderPage(group.id))

    expect(screen.getByText('支払報告の履歴')).toBeTruthy()
    expect(screen.getByText('12,500円')).toBeTruthy()
    expect(screen.getByText('証憑 1枚')).toBeTruthy()
    expect(screen.getByText('送信済')).toBeTruthy()
    expect(screen.getByText('prh-admin-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: '再送' })).toBeTruthy()
    // サムネはプレビュー route から引く（bytea をページ payload に載せない）。
    const thumb = document.querySelector('img[alt="振込明細"]') as HTMLImageElement
    expect(thumb.getAttribute('src')).toBe(
      '/api/line-broadcast/payment-receipts/tok-history-000000001/preview',
    )
  })

  it('新しい順に並ぶ', async () => {
    const admin = await createAdmin({ name: 'prh-admin-2' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedGroupWithPaidDay()
    await seedReport(group.id, {
      amountJpy: 1000,
      createdAt: new Date('2030-01-01T00:00:00Z'),
    })
    await seedReport(group.id, {
      amountJpy: 2000,
      createdAt: new Date('2030-02-01T00:00:00Z'),
    })

    const { container } = render(await renderPage(group.id))
    const amounts = Array.from(container.querySelectorAll('li'))
      .map((li) => li.textContent ?? '')
      .filter((t) => t.includes('円') && t.includes('証憑'))
    expect(amounts[0]).toContain('2,000円')
    expect(amounts[1]).toContain('1,000円')
  })

  it('送信失敗・LINE未連携は状態として区別して出る', async () => {
    const admin = await createAdmin({ name: 'prh-admin-3' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedGroupWithPaidDay()
    await seedReport(group.id, { status: 'failed', createdAt: new Date('2030-01-01T00:00:00Z') })
    await seedReport(group.id, {
      status: 'skipped_unlinked',
      createdAt: new Date('2030-02-01T00:00:00Z'),
    })

    render(await renderPage(group.id))
    expect(screen.getByText('送信失敗')).toBeTruthy()
    expect(screen.getByText('LINE未連携')).toBeTruthy()
  })

  it('未払に戻しても履歴は残る（AC-19）', async () => {
    const admin = await createAdmin({ name: 'prh-admin-4' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group, day } = await seedGroupWithPaidDay()
    await seedReport(group.id, { createdBy: admin.id }, ['tok-history-000000002'])

    await testDb
      .update(events)
      .set({ paymentStatus: 'unpaid', paymentPaidAt: null })
      .where(eq(events.id, day.id))

    render(await renderPage(group.id))
    expect(screen.getByText('支払報告の履歴')).toBeTruthy()
    expect(screen.getByText('証憑 1枚')).toBeTruthy()
    expect(await testDb.select().from(entryGroupPaymentReceipts)).toHaveLength(1)
  })

  it('非管理者には履歴も証憑も描画されない（AC-21）', async () => {
    const member = await createUser({ name: 'prh-member' })
    const { group } = await seedGroupWithPaidDay()
    await seedReport(group.id, {}, ['tok-history-000000003'])
    await setAuthSession({ id: member.id, role: 'member' })

    render(await renderPage(group.id))
    expect(screen.queryByText('支払報告の履歴')).toBeNull()
    expect(document.querySelector('img[alt="振込明細"]')).toBeNull()
  })

  it('報告が1件も無ければ履歴の見出しごと出ない', async () => {
    const admin = await createAdmin({ name: 'prh-admin-5' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { group } = await seedGroupWithPaidDay()

    render(await renderPage(group.id))
    expect(screen.queryByText('支払報告の履歴')).toBeNull()
  })
})
