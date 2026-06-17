import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  eventAttendances,
  eventBroadcastMessages,
  eventLineBroadcasts,
  lineChannels,
  mailMessages,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

const { broadcastMailToEventMock } = vi.hoisted(() => ({
  broadcastMailToEventMock: vi.fn(async () => ({
    status: 'sent' as const,
    sentLeadCount: 0,
    sentTextCount: 0,
    sentImageCount: 0,
    fallbackLinkCount: 0,
  })),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))
// manualBroadcast の再配信検証用。実配信 (LINE push) はテスト対象外なので
// broadcastMailToEvent をモックし、継承された引数 (leadText / isCorrection /
// force) を検証する。
vi.mock('@/lib/line-broadcast', () => ({
  broadcastMailToEvent: broadcastMailToEventMock,
}))

// Import under test AFTER mocks so @/auth resolution uses the mock.
const { submitAttendance, manualBroadcast } = await import('./actions')

function formWith(attend: boolean, comment?: string): FormData {
  const fd = new FormData()
  fd.append('attend', attend ? 'true' : 'false')
  if (comment) fd.append('comment', comment)
  return fd
}

async function getAttendance(eventId: number, userId: string) {
  return testDb.query.eventAttendances.findFirst({
    where: and(
      eq(eventAttendances.eventId, eventId),
      eq(eventAttendances.userId, userId),
    ),
  })
}

// 全 describe 共有の test DB プールはファイル単位で 1 回だけ閉じる
// (describe ごとに閉じると pg Pool.end() の二重呼び出しでエラーになる)。
afterAll(async () => {
  await closeTestDb()
})

// broadcast 監査行 (lead_text 入り) を seed して manualBroadcast の継承を検証する。
async function seedBroadcastAuditRow(opts: {
  leadText: string | null
}): Promise<{ eventId: number; mailMessageId: number }> {
  const channelRows = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: '@bot-test',
      purpose: 'event_broadcast',
      status: 'active',
    })
    .returning({ id: lineChannels.id })
  const event = await createEvent({ title: '再配信大会' })
  const broadcastRows = await testDb
    .insert(eventLineBroadcasts)
    .values({
      eventId: event.id,
      lineChannelId: channelRows[0]!.id,
      status: 'linked',
      lineGroupId: 'C123456789',
      linkedAt: new Date(),
    })
    .returning({ id: eventLineBroadcasts.id })
  const mailRows = await testDb
    .insert(mailMessages)
    .values({
      messageId: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: 'organiser@example.com',
      toAddresses: ['admin@kagetra'],
      subject: '補足連絡',
      receivedAt: new Date(),
      bodyText: '補足本文',
      status: 'ai_done',
    })
    .returning({ id: mailMessages.id })
  await testDb.insert(eventBroadcastMessages).values({
    eventLineBroadcastId: broadcastRows[0]!.id,
    mailMessageId: mailRows[0]!.id,
    status: 'sent',
    isCorrection: false,
    leadText: opts.leadText,
    sentLeadCount: opts.leadText ? 1 : 0,
  })
  return { eventId: event.id, mailMessageId: mailRows[0]!.id }
}

describe('submitAttendance — permission control', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('一般会員: isInvited=false では回答不可', async () => {
    const user = await createUser({ isInvited: false, grade: 'A' })
    const event = await createEvent({ title: 'E1' })
    await setAuthSession({ id: user.id, role: 'member' })

    await expect(submitAttendance(event.id, formWith(true))).rejects.toThrow(
      '出欠回答の対象外です',
    )
    expect(await getAttendance(event.id, user.id)).toBeUndefined()
  })

  it('一般会員: 会内締切経過後は回答不可', async () => {
    const user = await createUser({ isInvited: true, grade: 'A' })
    const event = await createEvent({
      title: 'E2',
      internalDeadline: '2020-01-01',
    })
    await setAuthSession({ id: user.id, role: 'member' })

    await expect(submitAttendance(event.id, formWith(true))).rejects.toThrow(
      '会内締切を過ぎています',
    )
    expect(await getAttendance(event.id, user.id)).toBeUndefined()
  })

  it('一般会員: eligibleGrades 不一致では回答不可', async () => {
    const user = await createUser({ isInvited: true, grade: 'E' })
    const event = await createEvent({
      title: 'E3',
      eligibleGrades: ['A', 'B'],
    })
    await setAuthSession({ id: user.id, role: 'member' })

    await expect(submitAttendance(event.id, formWith(true))).rejects.toThrow(
      '対象外の級です',
    )
    expect(await getAttendance(event.id, user.id)).toBeUndefined()
  })

  it('管理者: 締切後かつ対象外級でも回答可能（管理者特権）', async () => {
    const admin = await createAdmin({ isInvited: true, grade: 'E' })
    const event = await createEvent({
      title: 'E4',
      internalDeadline: '2020-01-01',
      eligibleGrades: ['A', 'B'],
    })
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(
      submitAttendance(event.id, formWith(true, 'admin override')),
    ).resolves.toBeUndefined()
    const row = await getAttendance(event.id, admin.id)
    expect(row).toMatchObject({ attend: true, comment: 'admin override' })
  })

  // Regression: sticky single-toggle UI submits only `attend`, so the action
  // must NOT wipe an existing comment when the form omits the `comment` field.
  it('toggle-only 再送信では既存のコメントが保持される', async () => {
    const user = await createUser({ isInvited: true, grade: 'A' })
    const event = await createEvent({ title: 'E5' })
    await setAuthSession({ id: user.id, role: 'member' })

    await submitAttendance(event.id, formWith(true, 'keep me'))
    expect(await getAttendance(event.id, user.id)).toMatchObject({
      attend: true,
      comment: 'keep me',
    })

    await submitAttendance(event.id, formWith(false))
    expect(await getAttendance(event.id, user.id)).toMatchObject({
      attend: false,
      comment: 'keep me',
    })
  })
})

describe('manualBroadcast — lead text inheritance', () => {
  beforeEach(async () => {
    await truncateAll()
    broadcastMailToEventMock.mockClear()
  })

  it('保存済み lead_text を継承して再送する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { eventId, mailMessageId } = await seedBroadcastAuditRow({
      leadText: '抽選結果が出ました！',
    })

    await manualBroadcast(eventId, mailMessageId)

    expect(broadcastMailToEventMock).toHaveBeenCalledTimes(1)
    const callArgs = broadcastMailToEventMock.mock.calls[0] as unknown as [
      unknown,
      {
        eventId: number
        mailMessageId: number
        isCorrection: boolean
        leadText: string | null
        force?: boolean
      },
    ]
    expect(callArgs[1]).toMatchObject({
      eventId,
      mailMessageId,
      isCorrection: false,
      leadText: '抽選結果が出ました！',
      force: true,
    })
  })

  it('lead_text=null の行は冒頭なしで再送する (従来挙動)', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const { eventId, mailMessageId } = await seedBroadcastAuditRow({
      leadText: null,
    })

    await manualBroadcast(eventId, mailMessageId)

    expect(broadcastMailToEventMock).toHaveBeenCalledTimes(1)
    const callArgs = broadcastMailToEventMock.mock.calls[0] as unknown as [
      unknown,
      { leadText: string | null },
    ]
    expect(callArgs[1].leadText).toBeNull()
  })
})
