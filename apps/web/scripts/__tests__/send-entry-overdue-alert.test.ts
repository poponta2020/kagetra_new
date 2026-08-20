import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import { addDays, todayInJst } from '@/lib/jst-date'
import { dryRun, main } from '../send-entry-overdue-alert'

// entry-overdue-alert タスク5: バッチの配線だけを見る。抽出条件・文面の内容は
// src/lib/entry-overdue-alert.test.ts が担保しているので、ここでは
// 「--dry-run で push しない」「引数なしなら push が 1 回だけ走る」を確認する。
// DATABASE_URL は vitest.setup.ts でテスト DB に固定されているため、main() が
// 自前で開く Pool もテスト DB を向く。

const BASE_URL = 'https://example.test'

// main() は today を注入できず jstTodayIso() を使うため、seed は実際の今日から
// 相対で作る（固定日付にすると開催日が過去になった時点で対象から外れて落ちる）。
const TODAY = todayInJst()

/**
 * 会内締切超過・未申込・開催日は未来・参加希望者 1 名 — アラート対象になる最小の 1 件。
 *
 * entry-management（§3.2.9）で抽出条件に「参加希望者 1 名以上」が加わったため、
 * 出欠を積まない大会は候補にならない。
 */
async function seedOverdueEvent(title = '締切超過大会') {
  const event = await createEvent({
    title,
    eventDate: addDays(TODAY, 30),
    internalDeadline: addDays(TODAY, -5),
    entryDeadline: addDays(TODAY, 10),
    entryStatus: 'not_applied',
  })
  const user = await createUser()
  await createEventAttendance({ eventId: event.id, userId: user.id, attend: true })
  return event
}

async function seedSystemChannel() {
  await testDb.insert(lineChannels).values({
    channelId: 'ch-system',
    channelSecret: 'secret',
    channelAccessToken: 'tok',
    botId: '@system',
    purpose: 'system_notify',
    status: 'system',
    notificationLineUserId: 'U-admin',
  })
}

const stdout: string[] = []

beforeEach(async () => {
  await truncateAll()
  stdout.length = 0
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  process.env.PUBLIC_BASE_URL = BASE_URL
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.PUBLIC_BASE_URL
})

afterAll(async () => {
  await closeTestDb()
})

describe('send-entry-overdue-alert — --dry-run', () => {
  it('候補を列挙するだけで push しない', async () => {
    const event = await seedOverdueEvent()
    await seedSystemChannel()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await main(['--dry-run'])

    expect(fetchSpy).not.toHaveBeenCalled()
    const out = stdout.join('')
    expect(out).toContain('DRY RUN')
    expect(out).toContain('1 candidate(s)')
    expect(out).toContain('締切超過大会')
    // entry-group-page AC-31: 管理者向けアラートの着地点はグループページ
    expect(out).toContain(`${BASE_URL}/admin/entries/${event.entryGroupId}`)
  })

  it('候補 0 件なら文面を出さない', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await main(['--dry-run'])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('0 candidate(s)')
  })

  it('dryRun() は today を注入でき、PUBLIC_BASE_URL 未設定でも例外にならない', async () => {
    await seedOverdueEvent()
    delete process.env.PUBLIC_BASE_URL

    const result = await dryRun(testDb, { today: TODAY })

    expect(result.candidateCount).toBe(1)
    expect(result.message).toContain('PUBLIC_BASE_URL 未設定')
  })
})

describe('send-entry-overdue-alert — 送信', () => {
  it('引数なしなら push が 1 回だけ走る', async () => {
    await seedOverdueEvent('A')
    await seedOverdueEvent('B')
    await seedSystemChannel()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await main([])

    // 大会ごとに 1 通ではなく、まとめて 1 通（要件 §3.2.1）。
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(stdout.join('')).toContain('2 candidate(s), push sent')
  })

  it('system_notify チャネル未設定ならスキップして正常終了する', async () => {
    await seedOverdueEvent()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(main([])).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('skipped: no-channel')
  })
})
