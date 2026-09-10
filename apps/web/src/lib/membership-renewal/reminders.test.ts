import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { clubLineGroups, lineChannels, lineChatTasks } from '@kagetra/shared/schema'
import { RENEWAL_MENTION_LIMIT_PER_MESSAGE } from '@kagetra/shared'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser } from '@/test-utils/seed'
import { startRenewal } from './store'
import { createReminderTasksForToday, previewReminderCandidates } from './reminders'

/**
 * reminders: 19:30 バッチ本体のテスト（annual-registration-renewal タスク8・
 * R7・AC-15・AC-16・AC-16b・AC-16c）。
 *
 * 対象日集合・送信時刻の導出自体は `schedule.test.ts` が担保しているので、
 * ここでは「対象日／未回答/表示名解決/分割/冪等性」の配線を見る。
 *
 * ★対象者は必ず `startOpenRenewal` を呼ぶ**前**に `createUser` すること
 * （AC-1: 対象集合は開始時点のスナップショットで確定する。開始後に作った
 * ユーザーは対象にならない）。
 */

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

afterAll(async () => {
  await closeTestDb()
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
})

beforeEach(async () => {
  await truncateAll()
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

/** S3（会 LINE グループ）を設定済みにする。`lineGroupId` は既定で捕捉済みにする。 */
async function seedClubLineGroup(overrides: { lineGroupId?: string | null } = {}) {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 's',
      channelAccessToken: 'club-token',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning({ id: lineChannels.id })
  const lineGroupId = 'lineGroupId' in overrides ? overrides.lineGroupId : 'Cwebhookgroup'
  const [group] = await testDb
    .insert(clubLineGroups)
    .values({
      lineChannelId: channel!.id,
      oamAccountPath: 'U16c4a1b2c3d4e5f60718293a4b5c6d70',
      oamChatRoomId: 'C432c0102030405060708090a0b0c0d0e',
      chatRoomName: '会グループ',
      lineGroupId,
    })
    .returning()
  return group!
}

/**
 * 進行中の年度確認を開始する（開始日 2027-03-10・締切 2027-03-25 が既定）。
 * 対象にしたい会員は必ずこれより前に `createUser` しておくこと。
 */
async function startOpenRenewal(opts: { deadline?: string } = {}) {
  const admin = await createAdmin({ name: 'admin' })
  const result = await startRenewal(
    { fiscalYear: 2027, deadline: opts.deadline ?? '2027-03-25', note: null },
    admin.id,
    new Date('2027-03-10T03:00:00Z'),
  )
  const renewalId = (result as { renewalId: number }).renewalId
  return renewalId
}

async function reminderTasksFor(renewalId: number) {
  return testDb
    .select()
    .from(lineChatTasks)
    .where(and(eq(lineChatTasks.renewalId, renewalId), eq(lineChatTasks.kind, 'reminder')))
    .orderBy(lineChatTasks.splitIndex)
}

describe('createReminderTasksForToday', () => {
  it('進行中の年度確認が無ければ skipped: no-open-renewal', async () => {
    const result = await createReminderTasksForToday({ now: new Date('2027-03-13T09:00:00Z') })
    expect(result).toEqual({ skipped: 'no-open-renewal' })
  })

  it('対象日でなければ skipped: not-target-date', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答', zenNichikyo: true, lineUserId: 'Uu1' })
    await startOpenRenewal()

    // 2027-03-14 は対象日集合（13,16,19,22,24,25）に含まれない。
    const result = await createReminderTasksForToday({
      now: new Date('2027-03-14T09:00:00Z'),
    })
    expect(result).toEqual({ skipped: 'not-target-date' })
  })

  it('未回答者が 0 人なら skipped: no-unanswered', async () => {
    await seedClubLineGroup()
    await startOpenRenewal()

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
    })
    expect(result).toEqual({ skipped: 'no-unanswered' })
  })

  it('対象日・未回答 1 人以上ならリマインドタスクを作る（本文に URL・締切・氏名を含む）', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true, lineUserId: null })
    const renewalId = await startOpenRenewal()

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
    })
    expect(result).toEqual({
      created: 1,
      renewalId,
      targetDate: '2027-03-13',
      taskIds: [expect.any(Number)],
    })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.messageText).toContain('未回答太郎')
    expect(tasks[0]!.messageText).toContain('https://example.test/renewal')
    expect(tasks[0]!.messageText).toContain('3/25')
    expect(tasks[0]!.targetUserIds).toHaveLength(1)
    // 送信予定は対象日 20:00 JST = 11:00 UTC。
    expect(tasks[0]!.scheduledSendAt.toISOString()).toBe('2027-03-13T11:00:00.000Z')
  })

  it('同日に再実行しても二重に作らない（同日再実行の冪等性・AC-15）', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true })
    const renewalId = await startOpenRenewal()

    const now = new Date('2027-03-13T09:00:00Z')
    const first = await createReminderTasksForToday({ now })
    expect(first).toMatchObject({ created: 1 })

    const second = await createReminderTasksForToday({ now })
    expect(second).toEqual({ skipped: 'already-created' })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks).toHaveLength(1)
  })

  it('20:00 − 5 分のマージンを過ぎていたら作らず margin-exceeded（catch-up 対策）', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true })
    const renewalId = await startOpenRenewal()

    // 2027-03-13 19:56 JST = 10:56 UTC。20:00-5分=19:55 JST を過ぎている。
    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T10:56:00Z'),
    })
    expect(result).toEqual({ skipped: 'margin-exceeded' })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks).toHaveLength(0)
  })

  it('表示名が解決できた対象者は mentions に載る（AC-16）', async () => {
    await seedClubLineGroup({ lineGroupId: 'Cwebhookgroup' })
    await createUser({ name: '未回答太郎', zenNichikyo: true, lineUserId: 'Uu-taro' })
    const renewalId = await startOpenRenewal()

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
      fetchDisplayName: async ({ userId }) => (userId === 'Uu-taro' ? 'たろう（LINE表示名）' : null),
    })
    expect(result).toMatchObject({ created: 1 })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks[0]!.mentions).toEqual([
      { displayName: 'たろう（LINE表示名）', placeholder: '未回答太郎' },
    ])
    expect(tasks[0]!.errorCode).toBeNull()
  })

  it('webhook 側グループ ID が未捕捉なら表示名解決を行わず全員テキスト列挙（AC-16c）', async () => {
    await seedClubLineGroup({ lineGroupId: null })
    await createUser({ name: '未回答太郎', zenNichikyo: true, lineUserId: 'Uu-taro' })
    const renewalId = await startOpenRenewal()

    let called = false
    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
      fetchDisplayName: async () => {
        called = true
        return 'にせもの'
      },
    })
    expect(result).toMatchObject({ created: 1 })
    expect(called).toBe(false)

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks[0]!.mentions).toEqual([])
    expect(tasks[0]!.errorCode).toBe('GROUP_ID_NOT_CAPTURED')
    expect(tasks[0]!.messageText).toContain('未回答太郎')
  })

  it('表示名 API が失敗した対象者はメンションから外れ、氏名のテキスト列挙のみで送られる（AC-16c）', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true, lineUserId: 'Uu-taro' })
    await createUser({ name: '未回答花子', zenNichikyo: true, lineUserId: 'Uu-hanako' })
    const renewalId = await startOpenRenewal()

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
      fetchDisplayName: async () => {
        throw new Error('LINE API error')
      },
    })
    expect(result).toMatchObject({ created: 1 })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks[0]!.mentions).toEqual([])
    expect(tasks[0]!.errorCode).toBe('DISPLAY_NAME_FETCH_FAILED')
    expect(tasks[0]!.messageText).toContain('未回答太郎')
    expect(tasks[0]!.messageText).toContain('未回答花子')
  })

  it('上限を超える未回答者は 10 分ずつずらした複数タスクへ分割される（AC-16b）', async () => {
    await seedClubLineGroup()
    const total = RENEWAL_MENTION_LIMIT_PER_MESSAGE + 3
    for (let i = 0; i < total; i++) {
      await createUser({ name: `未回答${String(i).padStart(2, '0')}`, zenNichikyo: true })
    }
    const renewalId = await startOpenRenewal()

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-13T09:00:00Z'),
    })
    expect(result).toMatchObject({ created: 2 })

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.splitIndex).toBe(0)
    expect(tasks[1]!.splitIndex).toBe(1)
    expect(tasks[0]!.targetUserIds).toHaveLength(RENEWAL_MENTION_LIMIT_PER_MESSAGE)
    expect(tasks[1]!.targetUserIds).toHaveLength(total - RENEWAL_MENTION_LIMIT_PER_MESSAGE)

    // 対象が重複せず、合計が全対象と一致する。
    const allIds = [...tasks[0]!.targetUserIds, ...tasks[1]!.targetUserIds]
    expect(new Set(allIds).size).toBe(total)

    // 20:00 JST と 20:10 JST（10 分ずらし）。
    expect(tasks[0]!.scheduledSendAt.toISOString()).toBe('2027-03-13T11:00:00.000Z')
    expect(tasks[1]!.scheduledSendAt.toISOString()).toBe('2027-03-13T11:10:00.000Z')
  })

  it('締切当日も対象日として扱われる', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true })
    const renewalId = await startOpenRenewal({ deadline: '2027-03-25' })

    const result = await createReminderTasksForToday({
      now: new Date('2027-03-25T09:00:00Z'),
    })
    expect(result).toMatchObject({ created: 1, targetDate: '2027-03-25' })
  })
})

describe('previewReminderCandidates（--dry-run）', () => {
  it('タスクを作らずに候補と本文プレビューだけを返す', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答太郎', zenNichikyo: true })
    const renewalId = await startOpenRenewal()

    const preview = await previewReminderCandidates({ now: new Date('2027-03-13T09:00:00Z') })
    expect(preview).toMatchObject({
      renewalId,
      targetDate: '2027-03-13',
      unansweredCount: 1,
      splitCount: 1,
    })
    expect((preview as { messages: string[] }).messages[0]).toContain('未回答太郎')

    const tasks = await reminderTasksFor(renewalId)
    expect(tasks).toHaveLength(0)
  })

  it('対象日でなければ skipped を返す', async () => {
    await seedClubLineGroup()
    await createUser({ name: '未回答', zenNichikyo: true })
    await startOpenRenewal()

    const preview = await previewReminderCandidates({ now: new Date('2027-03-14T09:00:00Z') })
    expect(preview).toEqual({ skipped: 'not-target-date' })
  })
})
