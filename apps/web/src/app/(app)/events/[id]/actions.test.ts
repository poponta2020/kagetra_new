import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { eventAttendances } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Import under test AFTER mocks so @/auth resolution uses the mock.
const { submitAttendance } = await import('./actions')

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

describe('submitAttendance — permission control', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
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
})
