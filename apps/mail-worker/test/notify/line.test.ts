import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { lineChannels } from '@kagetra/shared/schema'

/**
 * Hoisted mocks for `@line/bot-sdk` v11. The SDK exposes
 * `messagingApi.MessagingApiClient` (verified against
 * node_modules/@line/bot-sdk/dist/messaging-api/api/messagingApiClient.d.ts in
 * this worktree) — we replace the class with a constructor-spy + pushMessage
 * spy so we can assert on (a) the channelAccessToken pulled from the system
 * channel row and (b) the `{ to, messages }` payload built by
 * `pushSystemNotification`.
 *
 * `vi.hoisted` keeps the spies usable in both the mock factory (which vitest
 * hoists above imports) and the test bodies. Without hoisting the closure
 * would reference `undefined`.
 */
const { pushMessageSpy, constructorSpy, makeClientThrow } = vi.hoisted(() => {
  const pushMessageSpy = vi.fn(async (_req: unknown) => ({}))
  const constructorSpy = vi.fn()
  let throwOnPush: unknown = null
  return {
    pushMessageSpy,
    constructorSpy,
    makeClientThrow: (err: unknown) => {
      throwOnPush = err
      pushMessageSpy.mockImplementationOnce(async () => {
        throw throwOnPush
      })
    },
  }
})

vi.mock('@line/bot-sdk', () => {
  class FakeMessagingApiClient {
    constructor(config: { channelAccessToken: string }) {
      constructorSpy(config)
    }
    pushMessage = pushMessageSpy
  }
  return {
    messagingApi: {
      MessagingApiClient: FakeMessagingApiClient,
    },
  }
})

import {
  LineNotifyError,
  LineSystemChannelNotConfiguredError,
  getSystemChannel,
  pushSystemNotification,
} from '../../src/notify/line.js'
import { closeDb, getDb } from '../../src/db.js'
import { closeTestDb, testDb } from '../test-db.js'

const SYSTEM_CHANNEL_ID = 'C-system-1'
const SYSTEM_TOKEN = 'system-token-xyz'
const SYSTEM_BOT_ID = 'U-system-bot'
const SYSTEM_ADMIN_USER = 'U-admin-1'

async function truncateLineChannels() {
  // Only `line_channels` is touched by these tests; mail_messages stays
  // untouched so other test files can run in any order. CASCADE drops the
  // `users.line_channel_id` reverse pointer too, but no users are seeded here.
  await testDb.execute(sql`TRUNCATE TABLE line_channels RESTART IDENTITY CASCADE`)
}

interface SeedOpts {
  status?: 'available' | 'assigned' | 'active' | 'system' | 'disabled'
  channelId?: string
  channelAccessToken?: string
  botId?: string
  notificationLineUserId?: string | null
}

async function seedChannel(opts: SeedOpts = {}) {
  await testDb.insert(lineChannels).values({
    channelId: opts.channelId ?? SYSTEM_CHANNEL_ID,
    channelSecret: 'secret-xyz',
    channelAccessToken: opts.channelAccessToken ?? SYSTEM_TOKEN,
    botId: opts.botId ?? SYSTEM_BOT_ID,
    status: opts.status ?? 'system',
    notificationLineUserId:
      opts.notificationLineUserId === undefined
        ? SYSTEM_ADMIN_USER
        : opts.notificationLineUserId,
  })
}

describe('notify/line', () => {
  beforeEach(async () => {
    await truncateLineChannels()
    pushMessageSpy.mockReset()
    pushMessageSpy.mockResolvedValue({} as unknown as never)
    constructorSpy.mockReset()
    delete process.env.LINE_NOTIFY_DRY_RUN
  })

  afterEach(() => {
    delete process.env.LINE_NOTIFY_DRY_RUN
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  describe('getSystemChannel', () => {
    it("returns the row whose status='system'", async () => {
      // Seed an unrelated `available` row first to confirm the WHERE filter
      // actually narrows by status (rather than just LIMIT 1 on the table).
      await seedChannel({
        status: 'available',
        channelId: 'C-pool-1',
        channelAccessToken: 'pool-token',
      })
      await seedChannel({ status: 'system' })

      const channel = await getSystemChannel(getDb())

      expect(channel.channelAccessToken).toBe(SYSTEM_TOKEN)
      expect(channel.botId).toBe(SYSTEM_BOT_ID)
      expect(channel.notificationLineUserId).toBe(SYSTEM_ADMIN_USER)
    })

    it('throws LineSystemChannelNotConfiguredError when no system row exists', async () => {
      // An `available` row exists but no `system` row → operator hasn't
      // promoted any channel yet. Should hard-fail rather than silently use
      // the pool token.
      await seedChannel({ status: 'available' })

      await expect(getSystemChannel(getDb())).rejects.toBeInstanceOf(
        LineSystemChannelNotConfiguredError,
      )
    })
  })

  describe('pushSystemNotification', () => {
    it('calls MessagingApiClient.pushMessage with the channel token + admin userId', async () => {
      await seedChannel({ status: 'system' })

      const result = await pushSystemNotification(getDb(), 'hello LINE')

      expect(result.skipped).toBe(false)
      expect(constructorSpy).toHaveBeenCalledWith({
        channelAccessToken: SYSTEM_TOKEN,
      })
      expect(pushMessageSpy).toHaveBeenCalledTimes(1)
      expect(pushMessageSpy).toHaveBeenCalledWith({
        to: SYSTEM_ADMIN_USER,
        messages: [{ type: 'text', text: 'hello LINE' }],
      })
    })

    it("returns { skipped: true, reason: 'dry-run' } and DOES NOT call the SDK when LINE_NOTIFY_DRY_RUN=1", async () => {
      await seedChannel({ status: 'system' })
      process.env.LINE_NOTIFY_DRY_RUN = '1'

      const result = await pushSystemNotification(getDb(), 'dry message')

      expect(result).toEqual({ skipped: true, reason: 'dry-run' })
      expect(constructorSpy).not.toHaveBeenCalled()
      expect(pushMessageSpy).not.toHaveBeenCalled()
    })

    it("returns { skipped: true, reason: 'no-user-id' } when notificationLineUserId is null", async () => {
      // System channel is seeded but the LINE Login webhook (P3-B) hasn't
      // resolved an admin userId yet — we silently skip rather than hard-fail
      // so the rest of the pipeline keeps running.
      await seedChannel({ status: 'system', notificationLineUserId: null })

      const result = await pushSystemNotification(getDb(), 'no-userid msg')

      expect(result).toEqual({ skipped: true, reason: 'no-user-id' })
      expect(pushMessageSpy).not.toHaveBeenCalled()
    })

    it('wraps SDK errors in LineNotifyError with the original error on .cause', async () => {
      await seedChannel({ status: 'system' })
      const sdkError = new Error('401 Unauthorized')
      makeClientThrow(sdkError)

      const caught = await pushSystemNotification(getDb(), 'will fail')
        .then(() => null)
        .catch((e: unknown) => e)

      expect(caught).toBeInstanceOf(LineNotifyError)
      expect((caught as LineNotifyError).cause).toBe(sdkError)
      expect((caught as LineNotifyError).message).toMatch(/pushMessage failed/)
    })
  })
})
