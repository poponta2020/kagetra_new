import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Hoisted mocks for `@line/bot-sdk` v11. Mirrors the pattern in
 * `test/scripts/notify-system.test.ts` so the fallback CLI exercises the
 * same fake MessagingApiClient surface. Unlike notify-system, this CLI does
 * not touch the DB — there is no `truncateLineChannels()` setup, and
 * `beforeEach` only resets spies + env stubs.
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

import { runNotifyFallbackCli } from '../../scripts/notify-fallback.js'

const FALLBACK_TOKEN = 'fallback-token-xyz'
const FALLBACK_USER = 'U-fallback-admin-1'

describe('scripts/notify-fallback', () => {
  beforeEach(() => {
    pushMessageSpy.mockReset()
    pushMessageSpy.mockResolvedValue({} as unknown as never)
    constructorSpy.mockReset()
    vi.unstubAllEnvs()
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('returns 0 and does NOT hit the SDK when LINE_NOTIFY_DRY_RUN=1', async () => {
    // env is fully configured — dry-run should still short-circuit before
    // constructing the client. Verifies the env check has lower priority
    // than the dry-run check (same ordering as notify-system).
    vi.stubEnv('LINE_NOTIFY_DRY_RUN', '1')
    vi.stubEnv('LINE_FALLBACK_CHANNEL_ACCESS_TOKEN', FALLBACK_TOKEN)
    vi.stubEnv('LINE_FALLBACK_NOTIFY_USER_ID', FALLBACK_USER)

    const code = await runNotifyFallbackCli(['hello dry'])

    expect(code).toBe(0)
    expect(pushMessageSpy).not.toHaveBeenCalled()
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it('returns 0 and skips with stdout log when LINE_FALLBACK_* env vars are unset', async () => {
    // env-not-configured is the "operator hasn't wired the fallback yet" path.
    // We log + return 0 (see header docstring rationale) so backup.sh can
    // still rely on journalctl as the final channel. Assert on stdout to lock
    // in the greppable journal line.
    vi.stubEnv('LINE_FALLBACK_CHANNEL_ACCESS_TOKEN', '')
    vi.stubEnv('LINE_FALLBACK_NOTIFY_USER_ID', '')
    const stdoutLines: string[] = []
    const stdoutSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        stdoutLines.push(args.map((a) => String(a)).join(' '))
      })
    try {
      const code = await runNotifyFallbackCli(['hello unconfigured'])

      expect(code).toBe(0)
      expect(pushMessageSpy).not.toHaveBeenCalled()
      expect(constructorSpy).not.toHaveBeenCalled()
      expect(stdoutLines.join('\n')).toMatch(
        /\[notify-fallback\] skipped: env-not-configured/,
      )
    } finally {
      stdoutSpy.mockRestore()
    }
  })

  it('returns 0 and pushes through MessagingApiClient on the happy path', async () => {
    vi.stubEnv('LINE_FALLBACK_CHANNEL_ACCESS_TOKEN', FALLBACK_TOKEN)
    vi.stubEnv('LINE_FALLBACK_NOTIFY_USER_ID', FALLBACK_USER)
    pushMessageSpy.mockResolvedValueOnce({} as unknown as never)

    const code = await runNotifyFallbackCli(['hello LINE fallback'])

    expect(code).toBe(0)
    expect(constructorSpy).toHaveBeenCalledWith({
      channelAccessToken: FALLBACK_TOKEN,
    })
    expect(pushMessageSpy).toHaveBeenCalledTimes(1)
    expect(pushMessageSpy).toHaveBeenCalledWith({
      to: FALLBACK_USER,
      messages: [{ type: 'text', text: 'hello LINE fallback' }],
    })
  })

  it('returns 1 and writes to stderr when the SDK throws', async () => {
    vi.stubEnv('LINE_FALLBACK_CHANNEL_ACCESS_TOKEN', FALLBACK_TOKEN)
    vi.stubEnv('LINE_FALLBACK_NOTIFY_USER_ID', FALLBACK_USER)
    const sdkError = new Error('boom-fallback')
    pushMessageSpy.mockRejectedValueOnce(sdkError)
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    try {
      const code = await runNotifyFallbackCli(['will fail'])

      expect(code).toBe(1)
      const joined = stderrSpy.mock.calls
        .map((args) => String(args[0] ?? ''))
        .join('')
      expect(joined).toMatch(/\[notify-fallback\] error: LINE pushMessage failed/)
      expect(joined).toMatch(/boom-fallback/)
    } finally {
      stderrSpy.mockRestore()
    }
  })
})
