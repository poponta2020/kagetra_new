import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { lineChannels } from '@kagetra/shared/schema'

/**
 * Hoisted mocks for `@line/bot-sdk` v11. Mirrors the pattern in
 * `test/notify/line.test.ts` so the CLI wrapper exercises the same fake
 * MessagingApiClient. We assert against `pushMessageSpy` to confirm the bash
 * caller's message body lands in `{ to, messages: [{ type: 'text', text }] }`.
 *
 * `vi.hoisted` is required because vitest hoists `vi.mock` factories above
 * top-level imports; without hoisting, the factory would close over an
 * `undefined` spy reference.
 */
const { pushMessageSpy, constructorSpy } = vi.hoisted(() => {
  const pushMessageSpy = vi.fn(async (_req: unknown) => ({}))
  const constructorSpy = vi.fn()
  return { pushMessageSpy, constructorSpy }
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

import { runNotifySystemCli } from '../../scripts/notify-system.js'
import { closeDb } from '../../src/db.js'
import { closeTestDb, testDb } from '../test-db.js'

const SYSTEM_CHANNEL_ID = 'C-system-cli-1'
const SYSTEM_TOKEN = 'system-cli-token'
const SYSTEM_BOT_ID = 'U-system-cli-bot'
const SYSTEM_ADMIN_USER = 'U-cli-admin-1'

async function truncateLineChannels() {
  await testDb.execute(sql`TRUNCATE TABLE line_channels RESTART IDENTITY CASCADE`)
}

interface SeedOpts {
  notificationLineUserId?: string | null
}

async function seedSystemChannel(opts: SeedOpts = {}) {
  await testDb.insert(lineChannels).values({
    channelId: SYSTEM_CHANNEL_ID,
    channelSecret: 'secret-cli',
    channelAccessToken: SYSTEM_TOKEN,
    botId: SYSTEM_BOT_ID,
    status: 'system',
    notificationLineUserId:
      opts.notificationLineUserId === undefined
        ? SYSTEM_ADMIN_USER
        : opts.notificationLineUserId,
  })
}

describe('scripts/notify-system', () => {
  beforeEach(async () => {
    await truncateLineChannels()
    pushMessageSpy.mockReset()
    pushMessageSpy.mockResolvedValue({} as unknown as never)
    constructorSpy.mockReset()
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await closeDb()
    await closeTestDb()
  })

  it("returns 0 and does NOT hit the SDK when LINE_NOTIFY_DRY_RUN=1", async () => {
    vi.stubEnv('LINE_NOTIFY_DRY_RUN', '1')
    await seedSystemChannel()

    const code = await runNotifySystemCli(['hello dry'])

    expect(code).toBe(0)
    expect(pushMessageSpy).not.toHaveBeenCalled()
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it("returns 0 and skips when notification_line_user_id is null", async () => {
    await seedSystemChannel({ notificationLineUserId: null })

    const code = await runNotifySystemCli(['hello no-user'])

    expect(code).toBe(0)
    expect(pushMessageSpy).not.toHaveBeenCalled()
  })

  it('returns 1 and writes to stderr when the system channel is not seeded', async () => {
    // line_channels is empty after the beforeEach TRUNCATE — no system row.
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    try {
      const code = await runNotifySystemCli(['will not push'])

      expect(code).toBe(1)
      const joined = stderrSpy.mock.calls
        .map((args) => String(args[0] ?? ''))
        .join('')
      expect(joined).toMatch(/system channel not seeded/)
      expect(pushMessageSpy).not.toHaveBeenCalled()
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it('returns 0 and pushes through MessagingApiClient on the happy path', async () => {
    await seedSystemChannel()
    pushMessageSpy.mockResolvedValueOnce({} as unknown as never)

    const code = await runNotifySystemCli(['hello LINE'])

    expect(code).toBe(0)
    expect(constructorSpy).toHaveBeenCalledWith({
      channelAccessToken: SYSTEM_TOKEN,
    })
    expect(pushMessageSpy).toHaveBeenCalledTimes(1)
    expect(pushMessageSpy).toHaveBeenCalledWith({
      to: SYSTEM_ADMIN_USER,
      messages: [{ type: 'text', text: 'hello LINE' }],
    })
  })

  it('returns 1 and writes to stderr when the SDK throws', async () => {
    await seedSystemChannel()
    const sdkError = new Error('boom')
    pushMessageSpy.mockRejectedValueOnce(sdkError)
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    try {
      const code = await runNotifySystemCli(['will fail'])

      expect(code).toBe(1)
      const joined = stderrSpy.mock.calls
        .map((args) => String(args[0] ?? ''))
        .join('')
      expect(joined).toMatch(/LINE pushMessage failed/)
    } finally {
      stderrSpy.mockRestore()
    }
  })
})
