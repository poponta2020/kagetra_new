import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  eventGradeBroadcasts,
  lineChannels,
  lineGradeGroupBindings,
  mailAttachments,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage } from '@/test-utils/seed'
import {
  broadcastEventsToGradeGroups,
  buildGradeBroadcastMessage,
  resolveTargetGrades,
  type GradeBroadcastEntry,
} from './event-grade-broadcast'

// ---------------------------------------------------------------------------
// resolveTargetGrades (pure, no DB)
// ---------------------------------------------------------------------------

describe('resolveTargetGrades', () => {
  it('null なら全5級を返す', () => {
    expect(resolveTargetGrades(null)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('空配列なら全5級を返す', () => {
    expect(resolveTargetGrades([])).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('undefined なら全5級を返す', () => {
    expect(resolveTargetGrades(undefined)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('一致する級だけを A→E の固定順で返す', () => {
    expect(resolveTargetGrades(['C', 'A'])).toEqual(['A', 'C'])
  })

  it('単一の級を返す', () => {
    expect(resolveTargetGrades(['B'])).toEqual(['B'])
  })
})

// ---------------------------------------------------------------------------
// buildGradeBroadcastMessage (pure, no DB)
// ---------------------------------------------------------------------------

function entry(overrides: Partial<GradeBroadcastEntry> = {}): GradeBroadcastEntry {
  return {
    eventDate: '2026-08-15',
    title: '大阪AB',
    guidelineUrl: 'https://kagetra.example.com/api/line-broadcast/attachments/tok123',
    internalDeadline: '2026-07-25',
    ...overrides,
  }
}

describe('buildGradeBroadcastMessage', () => {
  it('AC-11: 要綱あり・締切ありは要件の現物どおりの文面になる', () => {
    const text = buildGradeBroadcastMessage([entry()])
    expect(text).toBe(
      [
        '8/15(土) 大阪ABの案内が来ました！',
        'https://kagetra.example.com/api/line-broadcast/attachments/tok123',
        '',
        '締切 は7/25です。',
      ].join('\n'),
    )
  })

  it('AC-12: 要綱なし・締切ありは URL 行を省略する', () => {
    const text = buildGradeBroadcastMessage([entry({ guidelineUrl: null })])
    expect(text).toBe(['8/15(土) 大阪ABの案内が来ました！', '', '締切 は7/25です。'].join('\n'))
    expect(text).not.toContain('http')
  })

  it('AC-13: 要綱あり・締切なしは空行込みで締切行を省略する', () => {
    const text = buildGradeBroadcastMessage([entry({ internalDeadline: null })])
    expect(text).toBe(
      ['8/15(土) 大阪ABの案内が来ました！', 'https://kagetra.example.com/api/line-broadcast/attachments/tok123'].join(
        '\n',
      ),
    )
    expect(text).not.toContain('締切')
  })

  it('要綱なし・締切なしは1行目だけになる', () => {
    const text = buildGradeBroadcastMessage([entry({ guidelineUrl: null, internalDeadline: null })])
    expect(text).toBe('8/15(土) 大阪ABの案内が来ました！')
  })

  it('締切は M/D 形式でゼロ埋め・曜日なし', () => {
    const text = buildGradeBroadcastMessage([entry({ internalDeadline: '2026-09-05' })])
    const deadlineLine = text.split('\n').at(-1)
    // 1行目の日付表記 `M/D(曜)` と区別するため締切行だけを見る（1行目は
    // 意図的に `(土)` を含むので `not.toContain('(')` を全文へ掛けると誤検出する）。
    expect(deadlineLine).toBe('締切 は9/5です。')
    expect(text).not.toContain('09/05')
  })

  it('AC-10: 複数件は区切り線で連結する', () => {
    const text = buildGradeBroadcastMessage([
      entry({ title: '大会1' }),
      entry({ title: '大会2', guidelineUrl: null, internalDeadline: null }),
    ])
    const parts = text.split('\n---\n')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('大会1')
    expect(parts[1]).toBe('8/15(土) 大会2の案内が来ました！')
  })

  it('空配列を渡すと空文字列になる', () => {
    expect(buildGradeBroadcastMessage([])).toBe('')
  })
})

// ---------------------------------------------------------------------------
// broadcastEventsToGradeGroups — DB integration
// ---------------------------------------------------------------------------

function okFetch() {
  return vi.fn<typeof fetch>(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
      }) as unknown as Response,
  )
}

function failFetch(status = 500) {
  return vi.fn<typeof fetch>(
    async () =>
      ({
        ok: false,
        status,
        headers: { get: () => null },
        text: async () => 'error',
      }) as unknown as Response,
  )
}

function bodyOf(fetchImpl: ReturnType<typeof okFetch>, callIndex = 0): { to: string; messages: { text: string }[] } {
  const call = fetchImpl.mock.calls[callIndex]
  if (!call) throw new Error(`no fetch call at index ${callIndex}`)
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string)
}

async function seedGradeBinding(
  grade: Grade,
  overrides: { status?: 'invite_pending' | 'joined_waiting_code' | 'linked' | 'revoked'; lineGroupId?: string | null } = {},
) {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-grade-${grade}-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: `tok-grade-${grade}`,
      botId: `@grade-bot-${grade}`,
      purpose: 'grade_broadcast',
      status: 'active',
    })
    .returning()
  if (!channel) throw new Error('failed to seed grade channel')

  const [binding] = await testDb
    .insert(lineGradeGroupBindings)
    .values({
      grade,
      lineChannelId: channel.id,
      status: 'linked',
      lineGroupId: `G${grade}`,
      linkedAt: new Date(),
      ...overrides,
    })
    .returning()
  if (!binding) throw new Error('failed to seed grade binding')
  return { channel, binding }
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

async function seedGuidelineAttachment() {
  const mail = await createMailMessage()
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mail.id,
      filename: 'guideline.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      data: Buffer.from('pdf'),
    })
    .returning()
  if (!attachment) throw new Error('failed to seed mail attachment')
  return attachment
}

const BASE_URL = 'https://kagetra.example.com'

describe('broadcastEventsToGradeGroups — DB', () => {
  const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN
  const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

  beforeEach(async () => {
    await truncateAll()
    // push 回数を fetch スタブで観測するテストが大半のため、環境変数由来の
    // DRY_RUN / PUBLIC_BASE_URL を毎テスト明示的に消して決定的にする
    // （entry-overdue-alert.test.ts と同じガード。DRY_RUN=1 だと pushGradeText /
    // pushSystemText が fetchImpl を一切呼ばず "sent" 扱いで返ってしまう）。
    delete process.env.LINE_NOTIFY_DRY_RUN
    delete process.env.PUBLIC_BASE_URL
  })
  afterAll(async () => {
    if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
    else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
    if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
    await closeTestDb()
  })

  it('AC-1: eligible_grades に一致する級のグループにだけ配信される', async () => {
    const event = await createEvent({ eligibleGrades: ['A', 'C'] })
    await seedGradeBinding('A')
    await seedGradeBinding('B')
    await seedGradeBinding('C')
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect([...result.sentGrades].sort()).toEqual(['A', 'C'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('AC-2: eligible_grades が null なら全5級のグループへ配信される', async () => {
    const event = await createEvent({ eligibleGrades: null })
    for (const g of ['A', 'B', 'C', 'D', 'E'] as const) {
      await seedGradeBinding(g)
    }
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect([...result.sentGrades].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('AC-2: eligible_grades が空配列でも全5級のグループへ配信される', async () => {
    const event = await createEvent({ eligibleGrades: [] })
    for (const g of ['A', 'B', 'C', 'D', 'E'] as const) {
      await seedGradeBinding(g)
    }
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect([...result.sentGrades].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('AC-3 / 全級未紐付けでも例外を投げず正常終了する', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const fetchImpl = okFetch()

    await expect(
      broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL }),
    ).resolves.toMatchObject({
      sentGrades: [],
      skippedGrades: ['A', 'B', 'C', 'D', 'E'],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('AC-4: 未紐付けの級はスキップされ、紐付け済みの級へは配信される', async () => {
    const event = await createEvent({ eligibleGrades: ['A', 'B'] })
    await seedGradeBinding('A')
    // B は紐付けなし
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.sentGrades).toEqual(['A'])
    expect(result.skippedGrades).toEqual(['B'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('AC-5: 未紐付けスキップで管理者へ通知が呼ばれる', async () => {
    const event = await createEvent({ eligibleGrades: ['C'] })
    await seedSystemChannel({ notificationLineUserId: 'Uadmin' })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.skippedGrades).toEqual(['C'])
    expect(result.notified).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchImpl, 0)
    expect(body.to).toBe('Uadmin')
    expect(body.messages[0]!.text).toContain('未紐付けでスキップ: C')
  })

  it('未紐付けでも system_notify チャネル未設定なら通知せずに正常終了する', async () => {
    const event = await createEvent({ eligibleGrades: ['C'] })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.skippedGrades).toEqual(['C'])
    expect(result.notified).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('AC-6 / push が失敗しても級グループの紐付けは解除されない', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })
    const { binding } = await seedGradeBinding('B')
    const fetchImpl = failFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.failedGrades).toEqual(['B'])
    const [current] = await testDb
      .select()
      .from(lineGradeGroupBindings)
      .where(eq(lineGradeGroupBindings.id, binding.id))
    expect(current!.status).toBe('linked')
    expect(current!.lineGroupId).toBe('GB')
  })

  it('push 失敗で claim が消え、未送信のまま残る（紐付けは残る）', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })
    await seedGradeBinding('B')
    const fetchImpl = failFetch()

    await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    const claims = await testDb.select().from(eventGradeBroadcasts).where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(claims).toHaveLength(0)
  })

  it('AC-7: push 失敗で管理者へ通知が呼ばれる', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })
    await seedGradeBinding('B')
    await seedSystemChannel({ notificationLineUserId: 'Uadmin' })
    const fetchImpl = failFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.failedGrades).toEqual(['B'])
    expect(result.notified).toBe(true)
    // 1回目 = グループ push 失敗、2回目 = 管理者通知
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const body = bodyOf(fetchImpl, 1)
    expect(body.to).toBe('Uadmin')
    expect(body.messages[0]!.text).toContain('送信失敗: B')
  })

  it('AC-8: 同じ (大会, 級) への2回目の配信は行われない', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    const first = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })
    expect(first.sentGrades).toEqual(['A'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const second = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })
    expect(second.sentGrades).toEqual([])
    // 2回目は claim できないので push は増えない
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('AC-9: 一部の級だけ送信成功した場合、成功した級だけ送信済みとして記録される', async () => {
    const event = await createEvent({ eligibleGrades: ['A', 'B'] })
    await seedGradeBinding('A')
    await seedGradeBinding('B')
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { to: string }
      const ok = body.to === 'GA'
      return {
        ok,
        status: ok ? 200 : 500,
        headers: { get: () => null },
        text: async () => 'error',
      } as unknown as Response
    })

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.sentGrades).toEqual(['A'])
    expect(result.failedGrades).toEqual(['B'])

    const rows = await testDb.select().from(eventGradeBroadcasts).where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.grade).toBe('A')
    expect(rows[0]!.sentAt).not.toBeNull()
  })

  it('AC-10: 同じ級に複数 event が該当する場合は1通にまとめて送られる', async () => {
    const event1 = await createEvent({ title: '大会1', eventDate: '2030-01-01', eligibleGrades: ['E'] })
    const event2 = await createEvent({ title: '大会2', eventDate: '2030-02-01', eligibleGrades: ['E'] })
    await seedGradeBinding('E')
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event1.id, event2.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    expect(result.sentGrades).toEqual(['E'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchImpl, 0)
    expect(body.messages[0]!.text).toContain('大会1')
    expect(body.messages[0]!.text).toContain('大会2')
    expect(body.messages[0]!.text).toContain('---')
  })

  it('AC-14: 要綱 URL は既存の共有トークン方式 (getOrCreateShareToken) で生成される', async () => {
    const attachment = await seedGuidelineAttachment()
    const event = await createEvent({ eligibleGrades: ['A'], gradeBroadcastAttachmentId: attachment.id })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    const body = bodyOf(fetchImpl, 0)
    expect(body.messages[0]!.text).toMatch(
      new RegExp(`${BASE_URL}/api/line-broadcast/attachments/[A-Za-z0-9_-]+`),
    )
  })

  it('AC-12: 要綱が未選択 (NULL) の大会は URL 行を出力しない', async () => {
    const event = await createEvent({ eligibleGrades: ['A'], gradeBroadcastAttachmentId: null })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    const body = bodyOf(fetchImpl, 0)
    expect(body.messages[0]!.text).not.toContain('http')
  })

  it('AC-13: internal_deadline が未設定の大会は締切行を出力しない', async () => {
    const event = await createEvent({ eligibleGrades: ['A'], internalDeadline: null })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    const body = bodyOf(fetchImpl, 0)
    expect(body.messages[0]!.text).not.toContain('締切')
  })

  it('放置された claim（sentAt NULL・claimedAt が5分以上前）は再 claim できる', async () => {
    const event = await createEvent({ eligibleGrades: ['D'] })
    await seedGradeBinding('D')
    // claim のリース判定は SQL 側で `now()`（= DB のクロック）と比較する。ここで
    // JS の `Date.now()` から古い時刻を作ると、Node と Docker の Postgres の
    // クロックずれ（この環境では実測 1.4 秒ほど DB が遅れている）がそのまま
    // 判定誤差になる。基準時刻も DB 側で作って同一クロックに揃える。
    await testDb
      .insert(eventGradeBroadcasts)
      .values({ eventId: event.id, grade: 'D', claimedAt: sql`now() - interval '6 minutes'` })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.sentGrades).toEqual(['D'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const rows = await testDb.select().from(eventGradeBroadcasts).where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).not.toBeNull()
  })

  it('直近5分以内の claim（別プロセスが処理中）は再 claim されない', async () => {
    const event = await createEvent({ eligibleGrades: ['D'] })
    await seedGradeBinding('D')
    // 上と同じ理由で基準時刻は DB 側の `now()` から作る。
    await testDb
      .insert(eventGradeBroadcasts)
      .values({ eventId: event.id, grade: 'D', claimedAt: sql`now() - interval '1 minute'` })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.sentGrades).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    const rows = await testDb.select().from(eventGradeBroadcasts).where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).toBeNull()
  })

  it('claimLeaseMs を短縮すればより短い放置時間でも再 claim できる', async () => {
    const event = await createEvent({ eligibleGrades: ['D'] })
    await seedGradeBinding('D')
    // 短いリースを検証するテストなので、クロックずれ（実測 1.4 秒）が
    // そのまま判定を反転させる。基準時刻は必ず DB 側の `now()` から作る。
    await testDb
      .insert(eventGradeBroadcasts)
      .values({ eventId: event.id, grade: 'D', claimedAt: sql`now() - interval '2 seconds'` })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
      claimLeaseMs: 1_000,
    })

    expect(result.sentGrades).toEqual(['D'])
  })

  it('revoked の紐付けは配信対象から外れる', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedGradeBinding('A', { status: 'revoked' })
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl, baseUrl: BASE_URL })

    expect(result.skippedGrades).toEqual(['A'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('eventIds が空配列なら何もせず終了する', async () => {
    const fetchImpl = okFetch()
    const result = await broadcastEventsToGradeGroups(testDb, [], { fetchImpl, baseUrl: BASE_URL })
    expect(result).toEqual({ sentGrades: [], skippedGrades: [], failedGrades: [], notified: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
