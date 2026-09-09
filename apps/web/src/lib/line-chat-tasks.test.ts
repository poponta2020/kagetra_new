import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  lineChatTasks,
  membershipRenewals,
} from '@kagetra/shared/schema'
import { LINE_CHAT_RESERVE_MARGIN_MINUTES, LINE_CHAT_RESERVING_STALE_MINUTES } from '@kagetra/shared'
import type { LineChatTaskStatus } from '@kagetra/shared'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  cancelTasks,
  createChatTask,
  createChatTasks,
  listWorkerTasks,
  notifyRenewalAdmin,
  reconcileTasks,
  reportTaskResult,
  retryChatTask,
} from './line-chat-tasks'

/**
 * line-chat-tasks: `line_chat_tasks` store のテスト（annual-registration-renewal
 * タスク4・AC-21/22/23・16c）。
 */

async function seedRenewal(overrides: { fiscalYear?: number; deadline?: string } = {}) {
  const [row] = await testDb
    .insert(membershipRenewals)
    .values({
      fiscalYear: overrides.fiscalYear ?? 2026,
      deadline: overrides.deadline ?? '2026-04-30',
    })
    .returning()
  if (!row) throw new Error('failed to seed membership_renewals')
  return row
}

async function seedClubLineGroup(overrides: { chatRoomName?: string } = {}) {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-club-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'club-token',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning()
  if (!channel) throw new Error('failed to seed line_channels')

  const [group] = await testDb
    .insert(clubLineGroups)
    .values({
      lineChannelId: channel.id,
      oamAccountPath: 'U1234567890abcdef1234567890abcdef',
      oamChatRoomId: 'Cabcdef1234567890abcdef1234567890',
      chatRoomName: overrides.chatRoomName ?? '北大かるた会',
    })
    .returning()
  if (!group) throw new Error('failed to seed club_line_groups')
  return group
}

async function seedSystemChannel(overrides: { notificationLineUserId?: string | null } = {}) {
  const notificationLineUserId =
    'notificationLineUserId' in overrides ? overrides.notificationLineUserId : 'Uadmin123'
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-sys-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'sys-token',
      botId: '@sys-bot',
      purpose: 'system_notify',
      status: 'system',
      notificationLineUserId,
    })
    .returning()
  if (!channel) throw new Error('failed to seed system channel')
  return channel
}

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 200 }))
}

async function seedTask(
  renewalId: number,
  overrides: Partial<typeof lineChatTasks.$inferInsert> = {},
) {
  const [row] = await testDb
    .insert(lineChatTasks)
    .values({
      renewalId,
      kind: 'reminder',
      targetDate: '2026-03-20',
      scheduledSendAt: new Date('2026-03-20T20:00:00+09:00'),
      messageText: 'テスト本文',
      ...overrides,
    })
    .returning()
  if (!row) throw new Error('failed to seed line_chat_tasks')
  return row
}

describe('line-chat-tasks', () => {
  const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN

  beforeEach(async () => {
    await truncateAll()
    delete process.env.LINE_NOTIFY_DRY_RUN
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  afterAll(async () => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
    await closeTestDb()
  })

  // -------------------------------------------------------------------------
  // createChatTask / createChatTasks
  // -------------------------------------------------------------------------
  describe('createChatTask', () => {
    it('新規タスクを作成し id を返す', async () => {
      const renewal = await seedRenewal()
      const result = await createChatTask(testDb, {
        renewalId: renewal.id,
        kind: 'announcement',
        targetDate: '2026-03-01',
        scheduledSendAt: new Date('2026-03-01T10:20:00+09:00'),
        messageText: '案内文',
      })
      expect('id' in result).toBe(true)
    })

    it('同じ (renewal, kind, targetDate, splitIndex) の未取消行があれば skipped:duplicate（読んでから書く形にしない）', async () => {
      const renewal = await seedRenewal()
      const input = {
        renewalId: renewal.id,
        kind: 'reminder' as const,
        targetDate: '2026-03-10',
        scheduledSendAt: new Date('2026-03-10T20:00:00+09:00'),
        messageText: '1通目',
      }
      const first = await createChatTask(testDb, input)
      expect('id' in first).toBe(true)
      const second = await createChatTask(testDb, { ...input, messageText: '2通目' })
      expect(second).toEqual({ skipped: 'duplicate' })

      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.messageText).toBe('1通目')
    })

    it('splitIndex が違えば別キー扱いで両方作成できる', async () => {
      const renewal = await seedRenewal()
      const base = {
        renewalId: renewal.id,
        kind: 'reminder' as const,
        targetDate: '2026-03-10',
        messageText: '本文',
      }
      const a = await createChatTask(testDb, {
        ...base,
        splitIndex: 0,
        scheduledSendAt: new Date('2026-03-10T20:00:00+09:00'),
      })
      const b = await createChatTask(testDb, {
        ...base,
        splitIndex: 1,
        scheduledSendAt: new Date('2026-03-10T20:10:00+09:00'),
      })
      expect('id' in a).toBe(true)
      expect('id' in b).toBe(true)
    })

    it('CANCELLED 済みの行があれば同じキーで作り直せる（部分 UNIQUE の対象外）', async () => {
      const renewal = await seedRenewal()
      const input = {
        renewalId: renewal.id,
        kind: 'reminder' as const,
        targetDate: '2026-03-10',
        scheduledSendAt: new Date('2026-03-10T20:00:00+09:00'),
        messageText: '1通目',
      }
      const first = await createChatTask(testDb, input)
      expect('id' in first).toBe(true)
      await testDb
        .update(lineChatTasks)
        .set({ status: 'CANCELLED' })
        .where(eq(lineChatTasks.id, (first as { id: number }).id))

      const second = await createChatTask(testDb, { ...input, messageText: '作り直し' })
      expect('id' in second).toBe(true)

      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      expect(rows).toHaveLength(2)
    })

    it('createChatTasks: 複数件をまとめて作成する', async () => {
      const renewal = await seedRenewal()
      const results = await createChatTasks(testDb, [
        {
          renewalId: renewal.id,
          kind: 'reminder',
          targetDate: '2026-03-10',
          splitIndex: 0,
          scheduledSendAt: new Date('2026-03-10T20:00:00+09:00'),
          messageText: '分割1',
          mentions: [{ displayName: '山田太郎', placeholder: '山田太郎' }],
        },
        {
          renewalId: renewal.id,
          kind: 'reminder',
          targetDate: '2026-03-10',
          splitIndex: 1,
          scheduledSendAt: new Date('2026-03-10T20:10:00+09:00'),
          messageText: '分割2',
        },
      ])
      expect(results.every((r) => 'id' in r)).toBe(true)
      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      expect(rows).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // listWorkerTasks (GET /tasks の中身。AC-21・AC-22)
  // -------------------------------------------------------------------------
  describe('listWorkerTasks', () => {
    it('club_line_groups が未設定なら空配列（エラーにしない）', async () => {
      const renewal = await seedRenewal()
      await seedTask(renewal.id, { status: 'PENDING' })
      const result = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(result).toEqual([])
    })

    it('AC-22: PENDING/CANCEL_PENDING だけを WorkerTask 契約形で返す（broadcastGroupId を含まない）', async () => {
      const group = await seedClubLineGroup()
      const renewal = await seedRenewal()
      const pending = await seedTask(renewal.id, {
        status: 'PENDING',
        scheduledSendAt: new Date('2026-03-10T20:00:00+09:00'),
        messageText: '本文A',
      })
      await seedTask(renewal.id, {
        status: 'RESERVING',
        targetDate: '2026-03-11',
        scheduledSendAt: new Date('2026-03-11T20:00:00+09:00'),
      })
      await seedTask(renewal.id, {
        status: 'RESERVED',
        targetDate: '2026-03-12',
        scheduledSendAt: new Date('2026-03-12T20:00:00+09:00'),
      })
      await seedTask(renewal.id, {
        status: 'CANCELLED',
        targetDate: '2026-03-13',
        scheduledSendAt: new Date('2026-03-13T20:00:00+09:00'),
      })

      const result = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(result).toHaveLength(1)
      const task = result[0]!
      expect(task).toEqual({
        id: pending.id,
        status: 'PENDING',
        chatRoomId: group.oamChatRoomId,
        chatRoomName: group.chatRoomName,
        scheduledSendAt: '2026-03-10T20:00:00+09:00',
        messageText: '本文A',
      })
      expect(Object.keys(task)).not.toContain('broadcastGroupId')
      expect(Object.keys(task)).not.toContain('sessionId')
    })

    it('mentions が空なら mentions キーごと省略する（旧ワーカー互換）', async () => {
      await seedClubLineGroup()
      const renewal = await seedRenewal()
      await seedTask(renewal.id, { status: 'PENDING', mentions: [] })
      const [task] = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(task).toBeDefined()
      expect('mentions' in task!).toBe(false)
    })

    it('mentions が非空なら含める', async () => {
      await seedClubLineGroup()
      const renewal = await seedRenewal()
      await seedTask(renewal.id, {
        status: 'PENDING',
        mentions: [{ displayName: '山田太郎', placeholder: '山田太郎' }],
      })
      const [task] = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(task!.mentions).toEqual([{ displayName: '山田太郎', placeholder: '山田太郎' }])
    })

    it('CANCEL_PENDING も返す', async () => {
      await seedClubLineGroup()
      const renewal = await seedRenewal()
      await seedTask(renewal.id, { status: 'CANCEL_PENDING' })
      const result = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(result).toHaveLength(1)
      expect(result[0]!.status).toBe('CANCEL_PENDING')
    })

    it(`送信予定時刻 − ${LINE_CHAT_RESERVE_MARGIN_MINUTES} 分を過ぎた行は返さない`, async () => {
      await seedClubLineGroup()
      const renewal = await seedRenewal()
      const now = new Date('2026-03-10T10:00:00+09:00')
      const boundary = new Date(now.getTime() + LINE_CHAT_RESERVE_MARGIN_MINUTES * 60_000)

      // ちょうど境界（scheduledSendAt == now + margin）は「過ぎた」ので除外。
      await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-10',
        scheduledSendAt: boundary,
      })
      // 境界より 1 分未来はまだ含める。
      const visible = await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-11',
        scheduledSendAt: new Date(boundary.getTime() + 60_000),
      })

      const result = await listWorkerTasks(testDb, now)
      expect(result.map((t) => t.id)).toEqual([visible.id])
    })

    it('複数行を scheduledSendAt 昇順で返す', async () => {
      await seedClubLineGroup()
      const renewal = await seedRenewal()
      const later = await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-12',
        scheduledSendAt: new Date('2026-03-12T20:00:00+09:00'),
      })
      const earlier = await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-11',
        scheduledSendAt: new Date('2026-03-11T20:00:00+09:00'),
      })
      const result = await listWorkerTasks(testDb, new Date('2026-03-10T10:00:00+09:00'))
      expect(result.map((t) => t.id)).toEqual([earlier.id, later.id])
    })
  })

  // -------------------------------------------------------------------------
  // reportTaskResult (POST /{id}/result の中身。AC-21)
  // -------------------------------------------------------------------------
  describe('reportTaskResult', () => {
    it('PENDING → RESERVING が成立し reservingAt が記録される', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'PENDING' })
      const result = await reportTaskResult(testDb, task.id, { status: 'RESERVING' })
      expect(result).toEqual({ ok: true })
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.status).toBe('RESERVING')
      expect(row!.reservingAt).not.toBeNull()
    })

    it('RESERVING → RESERVED / FAILED / MANUAL_REVIEW_REQUIRED / DRY_RUN_SUCCEEDED が成立する', async () => {
      const renewal = await seedRenewal()
      const statuses = [
        'RESERVED',
        'FAILED',
        'MANUAL_REVIEW_REQUIRED',
        'DRY_RUN_SUCCEEDED',
      ] as const
      for (const [index, status] of statuses.entries()) {
        const targetDate = `2026-03-${String(index + 1).padStart(2, '0')}`
        const task = await seedTask(renewal.id, { status: 'RESERVING', targetDate })
        const result = await reportTaskResult(testDb, task.id, { status })
        expect(result, status).toEqual({ ok: true })
      }
    })

    it('AC-16c: FAILED 報告の errorCode/errorMessage が保存される', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'RESERVING' })
      const result = await reportTaskResult(testDb, task.id, {
        status: 'FAILED',
        errorCode: 'MENTION_LOOKUP_FAILED',
        errorMessage: '表示名を取得できませんでした',
      })
      expect(result).toEqual({ ok: true })
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.errorCode).toBe('MENTION_LOOKUP_FAILED')
      expect(row!.errorMessage).toBe('表示名を取得できませんでした')
    })

    it('mentionResult が渡されれば保存される', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'RESERVING' })
      const result = await reportTaskResult(testDb, task.id, {
        status: 'RESERVED',
        mentionResult: { matched: ['山田太郎'], unmatched: ['佐藤花子'] },
      })
      expect(result).toEqual({ ok: true })
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.mentionResult).toEqual({ matched: ['山田太郎'], unmatched: ['佐藤花子'] })
    })

    it('CANCEL_PENDING → CANCELLED が成立する', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'CANCEL_PENDING' })
      const result = await reportTaskResult(testDb, task.id, { status: 'CANCELLED' })
      expect(result).toEqual({ ok: true })
    })

    it('遷移表に無い遷移は 409 相当（conflict）で拒否される', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'PENDING' })
      // PENDING から直接 RESERVED へは飛べない。
      const result = await reportTaskResult(testDb, task.id, { status: 'RESERVED' })
      expect(result).toEqual({ error: 'conflict' })
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.status).toBe('PENDING')
    })

    it('存在しない id は not_found', async () => {
      const result = await reportTaskResult(testDb, 999_999, { status: 'RESERVING' })
      expect(result).toEqual({ error: 'not_found' })
    })

    it('未知の status 文字列は conflict（存在する行に対して）', async () => {
      const renewal = await seedRenewal()
      const task = await seedTask(renewal.id, { status: 'PENDING' })
      const result = await reportTaskResult(testDb, task.id, {
        // ワーカー入力の不正値（未知の status 文字列）を模す。
        status: 'UNKNOWN_STATUS' as unknown as LineChatTaskStatus,
      })
      expect(result).toEqual({ error: 'conflict' })
    })
  })

  // -------------------------------------------------------------------------
  // cancelTasks（締切変更・登録完了から呼ばれる）
  // -------------------------------------------------------------------------
  describe('cancelTasks', () => {
    it('PENDING → CANCELLED、RESERVED → CANCEL_PENDING、RESERVING は触らない', async () => {
      const renewal = await seedRenewal()
      const pending = await seedTask(renewal.id, { status: 'PENDING', targetDate: '2026-03-01' })
      const reserved = await seedTask(renewal.id, { status: 'RESERVED', targetDate: '2026-03-02' })
      const reserving = await seedTask(renewal.id, { status: 'RESERVING', targetDate: '2026-03-03' })

      const count = await cancelTasks(testDb, { renewalId: renewal.id })
      expect(count).toBe(2)

      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      const byId = new Map(rows.map((r) => [r.id, r.status]))
      expect(byId.get(pending.id)).toBe('CANCELLED')
      expect(byId.get(reserved.id)).toBe('CANCEL_PENDING')
      expect(byId.get(reserving.id)).toBe('RESERVING')
    })

    it('kinds で絞り込める', async () => {
      const renewal = await seedRenewal()
      const announcement = await seedTask(renewal.id, {
        status: 'PENDING',
        kind: 'announcement',
        targetDate: '2026-03-01',
      })
      const reminder = await seedTask(renewal.id, {
        status: 'PENDING',
        kind: 'reminder',
        targetDate: '2026-03-02',
      })
      const count = await cancelTasks(testDb, { renewalId: renewal.id, kinds: ['reminder'] })
      expect(count).toBe(1)
      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      const byId = new Map(rows.map((r) => [r.id, r.status]))
      expect(byId.get(announcement.id)).toBe('PENDING')
      expect(byId.get(reminder.id)).toBe('CANCELLED')
    })

    it('keepTargetDates に含まれる日は取り消さない（締切変更で残す対象日）', async () => {
      const renewal = await seedRenewal()
      const keep = await seedTask(renewal.id, { status: 'PENDING', targetDate: '2026-03-05' })
      const drop = await seedTask(renewal.id, { status: 'PENDING', targetDate: '2026-03-08' })
      const count = await cancelTasks(testDb, {
        renewalId: renewal.id,
        keepTargetDates: ['2026-03-05'],
      })
      expect(count).toBe(1)
      const rows = await testDb
        .select()
        .from(lineChatTasks)
        .where(eq(lineChatTasks.renewalId, renewal.id))
      const byId = new Map(rows.map((r) => [r.id, r.status]))
      expect(byId.get(keep.id)).toBe('PENDING')
      expect(byId.get(drop.id)).toBe('CANCELLED')
    })

    it('他の renewal の行には影響しない', async () => {
      const renewalA = await seedRenewal({ fiscalYear: 2026 })
      const renewalB = await seedRenewal({ fiscalYear: 2027 })
      const taskA = await seedTask(renewalA.id, { status: 'PENDING' })
      const taskB = await seedTask(renewalB.id, { status: 'PENDING' })
      await cancelTasks(testDb, { renewalId: renewalA.id })
      const [rowA] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, taskA.id))
      const [rowB] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, taskB.id))
      expect(rowA!.status).toBe('CANCELLED')
      expect(rowB!.status).toBe('PENDING')
    })
  })

  // -------------------------------------------------------------------------
  // retryChatTask（S3 から呼ばれる。認可は呼び出し側の責務）
  // -------------------------------------------------------------------------
  describe('retryChatTask', () => {
    it('FAILED かつ送信予定が未来なら PENDING に戻り、errorCode/Message がクリアされる', async () => {
      const renewal = await seedRenewal()
      const future = new Date(Date.now() + 60 * 60_000)
      const task = await seedTask(renewal.id, {
        status: 'FAILED',
        scheduledSendAt: future,
        errorCode: 'PENDING_EXPIRED',
        errorMessage: '期限切れ',
      })
      const result = await retryChatTask(task.id)
      expect(result).toEqual({})
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.status).toBe('PENDING')
      expect(row!.errorCode).toBeNull()
      expect(row!.errorMessage).toBeNull()
    })

    it('送信予定が過去なら再試行できない', async () => {
      const renewal = await seedRenewal()
      const past = new Date(Date.now() - 60 * 60_000)
      const task = await seedTask(renewal.id, { status: 'FAILED', scheduledSendAt: past })
      const result = await retryChatTask(task.id)
      expect(result.error).toBeTruthy()
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.status).toBe('FAILED')
    })

    it('FAILED 以外の状態は再試行できない', async () => {
      const renewal = await seedRenewal()
      const future = new Date(Date.now() + 60 * 60_000)
      const task = await seedTask(renewal.id, { status: 'PENDING', scheduledSendAt: future })
      const result = await retryChatTask(task.id)
      expect(result.error).toBeTruthy()
    })

    it('存在しない id はエラーを返す', async () => {
      const result = await retryChatTask(999_999)
      expect(result.error).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // reconcileTasks（19:30 バッチが呼ぶ。タスク8 が利用）
  // -------------------------------------------------------------------------
  describe('reconcileTasks', () => {
    it(`RESERVING が ${LINE_CHAT_RESERVING_STALE_MINUTES} 分超で MANUAL_REVIEW_REQUIRED になる`, async () => {
      const renewal = await seedRenewal()
      const now = new Date('2026-03-10T19:30:00+09:00')
      const stale = await seedTask(renewal.id, {
        status: 'RESERVING',
        reservingAt: new Date(now.getTime() - (LINE_CHAT_RESERVING_STALE_MINUTES + 1) * 60_000),
      })
      const fresh = await seedTask(renewal.id, {
        status: 'RESERVING',
        targetDate: '2026-03-11',
        reservingAt: new Date(now.getTime() - (LINE_CHAT_RESERVING_STALE_MINUTES - 1) * 60_000),
      })

      const result = await reconcileTasks(testDb, now)
      expect(result.staleReserving).toBe(1)

      const [staleRow] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, stale.id))
      const [freshRow] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, fresh.id))
      expect(staleRow!.status).toBe('MANUAL_REVIEW_REQUIRED')
      expect(staleRow!.errorCode).toBe('RESERVING_STALE')
      expect(freshRow!.status).toBe('RESERVING')
    })

    it(`送信予定時刻 − ${LINE_CHAT_RESERVE_MARGIN_MINUTES} 分を過ぎた PENDING が FAILED(PENDING_EXPIRED) になる`, async () => {
      const renewal = await seedRenewal()
      const now = new Date('2026-03-10T19:30:00+09:00')
      const boundary = new Date(now.getTime() + LINE_CHAT_RESERVE_MARGIN_MINUTES * 60_000)
      const expired = await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-10',
        scheduledSendAt: boundary,
      })
      const notYet = await seedTask(renewal.id, {
        status: 'PENDING',
        targetDate: '2026-03-11',
        scheduledSendAt: new Date(boundary.getTime() + 60_000),
      })

      const result = await reconcileTasks(testDb, now)
      expect(result.expiredPending).toBe(1)

      const [expiredRow] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, expired.id))
      const [notYetRow] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, notYet.id))
      expect(expiredRow!.status).toBe('FAILED')
      expect(expiredRow!.errorCode).toBe('PENDING_EXPIRED')
      expect(notYetRow!.status).toBe('PENDING')
    })

    it('同日の再実行は冪等（既に倒した行を再度触らない）', async () => {
      const renewal = await seedRenewal()
      const now = new Date('2026-03-10T19:30:00+09:00')
      const task = await seedTask(renewal.id, {
        status: 'RESERVING',
        reservingAt: new Date(now.getTime() - (LINE_CHAT_RESERVING_STALE_MINUTES + 1) * 60_000),
      })
      const first = await reconcileTasks(testDb, now)
      expect(first.staleReserving).toBe(1)
      const second = await reconcileTasks(testDb, now)
      expect(second.staleReserving).toBe(0)
      const [row] = await testDb.select().from(lineChatTasks).where(eq(lineChatTasks.id, task.id))
      expect(row!.status).toBe('MANUAL_REVIEW_REQUIRED')
    })
  })

  // -------------------------------------------------------------------------
  // notifyRenewalAdmin（AC-23。entry-overdue-alert.ts の再利用）
  // -------------------------------------------------------------------------
  describe('notifyRenewalAdmin', () => {
    it('system_notify チャネルが設定されていれば push する', async () => {
      await seedSystemChannel()
      const fetchImpl = okFetch()
      const result = await notifyRenewalAdmin(testDb, 'テスト通知本文', { fetchImpl })
      expect(result).toEqual({ notified: true })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const call = fetchImpl.mock.calls[0]!
      const body = JSON.parse(String(call[1]?.body)) as { to: string; messages: { text: string }[] }
      expect(body.to).toBe('Uadmin123')
      expect(body.messages[0]!.text).toBe('テスト通知本文')
    })

    it('system_notify チャネルが無ければ push せず notified:false', async () => {
      const fetchImpl = okFetch()
      const result = await notifyRenewalAdmin(testDb, 'テスト通知本文', { fetchImpl })
      expect(result).toEqual({ notified: false })
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('notification_line_user_id が未設定なら push せず notified:false', async () => {
      await seedSystemChannel({ notificationLineUserId: null })
      const fetchImpl = okFetch()
      const result = await notifyRenewalAdmin(testDb, 'テスト通知本文', { fetchImpl })
      expect(result).toEqual({ notified: false })
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })
})
