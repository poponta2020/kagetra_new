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

function failFetch(status = 400) {
  // 既定は 400（＝受理されていないことが確かな失敗）。5xx / タイムアウトは
  // 「受理されたか不明」で claim を残す別扱いになるため、claim が取り消される
  // ことを検証するテストは必ず 4xx を使う。
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

function retryKeyOf(fetchImpl: ReturnType<typeof okFetch>, callIndex = 0): string {
  const call = fetchImpl.mock.calls[callIndex]
  if (!call) throw new Error(`no fetch call at index ${callIndex}`)
  const headers = (call[1] as RequestInit).headers as Record<string, string>
  return headers['X-Line-Retry-Key']!
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
    // グループ push は失敗させ、管理者通知だけは成功させる（notified は通知の
    // 実際の送信成否を返すようになったため、同じ失敗 fetch を使い回すと
    // 「通知が呼ばれたか」ではなく「通知も失敗したか」を見てしまう）。
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { to: string }
      const ok = body.to === 'Uadmin'
      return {
        ok,
        status: ok ? 200 : 400,
        headers: { get: () => null },
        text: async () => 'error',
      } as unknown as Response
    })

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
        // B 級は 400（受理されていないことが確かな失敗）にする。5xx にすると
        // 「受理されたか不明」となり claim を残す仕様なので、この AC の検証
        // （失敗した級は記録を残さない）とは別の経路になる。
        status: ok ? 200 : 400,
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
    expect(result).toEqual({
      sentGrades: [],
      skippedGrades: [],
      failedGrades: [],
      deliveryUnknownGrades: [],
      notified: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // ─── review R4 blocker: retry key と元 push リクエストの対応を崩さない ─────

  it('まとめ送信がタイムアウトした後、1大会だけ再送しても元のバッチ全体を同じキーで送り直す', async () => {
    await seedGradeBinding('A')
    const eventA = await createEvent({ eligibleGrades: ['A'], title: '大会A' })
    const eventB = await createEvent({ eligibleGrades: ['A'], title: '大会B' })

    // まとめて送ろうとしてタイムアウト（受理されたか不明）。
    const timeoutFetch = vi.fn<typeof fetch>(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    await broadcastEventsToGradeGroups(testDb, [eventA.id, eventB.id], {
      fetchImpl: timeoutFetch,
      baseUrl: BASE_URL,
    })
    const stored = await testDb.select().from(eventGradeBroadcasts)
    expect(stored).toHaveLength(2)
    const batchKey = stored[0]!.retryKey
    expect(stored.every((r) => r.retryKey === batchKey)).toBe(true)

    // リースを失効させ、個別画面から eventA だけ再送する。
    await testDb
      .update(eventGradeBroadcasts)
      .set({ claimedAt: sql`now() - interval '1 hour'` })
    const retry = okFetch()
    await broadcastEventsToGradeGroups(testDb, [eventA.id], {
      fetchImpl: retry,
      baseUrl: BASE_URL,
    })

    // 元のバッチ構成 (A+B) が復元され、同じキーで送られること。A だけを同じキーで
    // 送ってしまうと、続く B の再送が 409 になり「送っていないのに送信済み」になる。
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retryKeyOf(retry)).toBe(batchKey)
    const text = bodyOf(retry).messages.map((m) => m.text).join('\n')
    expect(text).toContain('大会A')
    expect(text).toContain('大会B')

    // 2 件ともまとめて確定する。
    const after = await testDb.select().from(eventGradeBroadcasts)
    expect(after).toHaveLength(2)
    expect(after.every((r) => r.sentAt != null)).toBe(true)
  })

  it('retry key の保持期間(24h)を過ぎた受理不明の送信は自動再送せず管理者へ回す', async () => {
    const { binding } = await seedGradeBinding('A')
    expect(binding.grade).toBe('A')
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedSystemChannel({ notificationLineUserId: 'Uadmin' })

    // 25 時間前に発行された受理不明の claim。
    await testDb.insert(eventGradeBroadcasts).values({
      eventId: event.id,
      grade: 'A',
      retryKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      claimedAt: sql`now() - interval '25 hours'`,
      createdAt: sql`now() - interval '25 hours'`,
    })

    const fetchImpl = okFetch()
    const result = await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    // 同じキーで送り直すと LINE 側では新規リクエスト扱いになり、元が受理済み
    // だった場合に二重配信になる。送らずに管理者通知へ回す。
    expect(result.deliveryUnknownGrades).toEqual(['A'])
    expect(result.sentGrades).toEqual([])
    // 級グループへの push は行わず、管理者通知の 1 通だけ。
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl).to).toBe('Uadmin')
    expect(bodyOf(fetchImpl).messages[0]!.text).toContain('配信結果不明')

    // claim は残す（人が判断するまで消さない）。
    const rows = await testDb.select().from(eventGradeBroadcasts)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).toBeNull()
  })

  it('管理者通知の push が失敗したら notified=false を返す', async () => {
    const event = await createEvent({ eligibleGrades: ['C'] })
    await seedSystemChannel({ notificationLineUserId: 'Uadmin' })
    // 級は未紐付け（スキップ）なので、この fetch は管理者通知にだけ使われる。
    const fetchImpl = failFetch(400)

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    expect(result.skippedGrades).toEqual(['C'])
    // 通知が届いていないのに notified=true を返すと、呼び出し側が誤解する。
    expect(result.notified).toBe(false)
  })

  // ─── review r1 blocker: push 成功後の確定失敗で二重配信しない ───────────

  it('push 成功後に sent_at 確定が失敗しても claim を消さない（再送で二重配信しない）', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    // push は成功、その直後の UPDATE だけを失敗させる。
    const brokenDb = new Proxy(testDb, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return () => {
            throw new Error('DB went away after push')
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }) as typeof testDb

    const result = await broadcastEventsToGradeGroups(brokenDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.failedGrades).toEqual(['A'])

    // claim 行が残っていること。ここで消してしまうと、次回の配信・再送で
    // 同じ本文がもう一度 LINE に届く（AC-8 違反）。
    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).toBeNull()
  })

  it('同じ内容の再送は同じ X-Line-Retry-Key を送る（LINE 側で冪等化される）', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedGradeBinding('A')

    const first = okFetch()
    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: first,
      baseUrl: BASE_URL,
    })
    const firstKey = retryKeyOf(first)

    // claim を放置状態へ戻し（プロセス停止相当）、リースを過ぎさせて再 claim させる。
    await testDb
      .update(eventGradeBroadcasts)
      .set({ sentAt: null, claimedAt: sql`now() - interval '1 hour'` })
      .where(eq(eventGradeBroadcasts.eventId, event.id))

    const second = okFetch()
    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: second,
      baseUrl: BASE_URL,
    })

    expect(firstKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    // retry key は claim 行に永続化されるので、再 claim でも同じキーが返る。
    expect(retryKeyOf(second)).toBe(firstKey)
  })

  // review R2 blocker: キーを「その場の claim 行集合」から導くと、まとめて送った後に
  // 一部だけ再送した瞬間に別キーになり、LINE の重複排除がすり抜ける。
  it('まとめて送った後に一部の大会だけ再送しても、元の送信と同じ retry key を使う', async () => {
    await seedGradeBinding('A')
    const eventA = await createEvent({ eligibleGrades: ['A'], title: '大会A' })
    const eventB = await createEvent({ eligibleGrades: ['A'], title: '大会B' })

    // 1 回目: 2 件をまとめて 1 通で送る（AC-10）。
    const first = okFetch()
    await broadcastEventsToGradeGroups(testDb, [eventA.id, eventB.id], {
      fetchImpl: first,
      baseUrl: BASE_URL,
    })
    expect(first).toHaveBeenCalledTimes(1)
    const batchKey = retryKeyOf(first)

    // 確定だけ失敗した状態を再現（LINE には届いている / sent_at は NULL のまま）。
    await testDb
      .update(eventGradeBroadcasts)
      .set({ sentAt: null, claimedAt: sql`now() - interval '1 hour'` })

    // 2 回目: 個別画面から eventA だけ再送する。
    const second = okFetch()
    await broadcastEventsToGradeGroups(testDb, [eventA.id], {
      fetchImpl: second,
      baseUrl: BASE_URL,
    })

    // 集合が [A,B] から [A] に変わってもキーは変わらない = LINE が重複排除できる。
    expect(retryKeyOf(second)).toBe(batchKey)
  })

  it('新しく作られた大会は別の retry key で送られる（重複排除に巻き込まれない）', async () => {
    await seedGradeBinding('A')
    const eventA = await createEvent({ eligibleGrades: ['A'], title: '大会A' })

    const first = okFetch()
    await broadcastEventsToGradeGroups(testDb, [eventA.id], {
      fetchImpl: first,
      baseUrl: BASE_URL,
    })

    const eventB = await createEvent({ eligibleGrades: ['A'], title: '大会B' })
    const second = okFetch()
    await broadcastEventsToGradeGroups(testDb, [eventB.id], {
      fetchImpl: second,
      baseUrl: BASE_URL,
    })

    expect(retryKeyOf(second)).not.toBe(retryKeyOf(first))
  })

  it('リース失効で別プロセスに再 claim された行を、古い処理は削除しない', async () => {
    await seedGradeBinding('A')
    const event = await createEvent({ eligibleGrades: ['A'] })

    // 先行プロセスが claim した状態を作る（claimed_at は古い）。
    await testDb.insert(eventGradeBroadcasts).values({
      eventId: event.id,
      grade: 'A',
      claimedAt: sql`now() - interval '1 hour'`,
      retryKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })

    // 再 claim → push 失敗 → 自分の claim だけを消す。
    const fetchImpl = failFetch(400)
    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    // 自分が取り直した claim なので消えている（孤児を残さない）。
    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(0)
  })

  // review R3 blocker: タイムアウト・5xx は「受理されたか不明」。claim と retry_key を
  // 消すと、次回は新しいキーで送られ、最初の要求が実は受理されていた場合に二重配信になる。
  it('タイムアウトでは claim と retry_key を残し、次回も同じキーで再試行する', async () => {
    await seedGradeBinding('A')
    const event = await createEvent({ eligibleGrades: ['A'] })

    const timeoutFetch = vi.fn<typeof fetch>(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    const first = await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: timeoutFetch,
      baseUrl: BASE_URL,
    })
    expect(first.failedGrades).toEqual(['A'])

    // claim は残っている（消すと次回別キーになる）。
    const afterTimeout = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(afterTimeout).toHaveLength(1)
    expect(afterTimeout[0]!.sentAt).toBeNull()
    const keptKey = afterTimeout[0]!.retryKey
    expect(keptKey).not.toBeNull()

    // リース失効後の再試行は同じキーで送る。
    await testDb
      .update(eventGradeBroadcasts)
      .set({ claimedAt: sql`now() - interval '1 hour'` })
    const retry = okFetch()
    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: retry,
      baseUrl: BASE_URL,
    })
    expect(retryKeyOf(retry)).toBe(keptKey)
  })

  it('5xx でも claim を残す（受理されたか不明なため）', async () => {
    await seedGradeBinding('A')
    const event = await createEvent({ eligibleGrades: ['A'] })

    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: failFetch(503),
      baseUrl: BASE_URL,
    })

    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).toBeNull()
  })

  it('4xx（受理されていないことが確か）では claim を取り消す', async () => {
    await seedGradeBinding('A')
    const event = await createEvent({ eligibleGrades: ['A'] })

    await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl: failFetch(400),
      baseUrl: BASE_URL,
    })

    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(0)
  })

  // review R3 should_fix: URL 設定の不備で、URL を必要としない級まで止めない。
  it('要綱ありの級だけ baseUrl 不備で失敗し、添付なしの級は配信される', async () => {
    await seedGradeBinding('A')
    await seedGradeBinding('B')
    const attachment = await seedGuidelineAttachment()
    const withAttachment = await createEvent({
      eligibleGrades: ['A'],
      gradeBroadcastAttachmentId: attachment.id,
    })
    const withoutAttachment = await createEvent({ eligibleGrades: ['B'] })
    const fetchImpl = okFetch()

    // baseUrl は渡さず env も未設定 → 解決失敗。
    const result = await broadcastEventsToGradeGroups(
      testDb,
      [withAttachment.id, withoutAttachment.id],
      { fetchImpl },
    )

    expect(result.failedGrades).toEqual(['A'])
    expect(result.sentGrades).toEqual(['B'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('5 通に収まらない本文は切り捨てず、送信失敗として claim を戻す', async () => {
    await seedGradeBinding('A')
    const longTitle = 'あ'.repeat(195)
    const eventIds: number[] = []
    for (let i = 0; i < 200; i++) {
      const ev = await createEvent({ eligibleGrades: ['A'], title: `${longTitle}${i}` })
      eventIds.push(ev.id)
    }
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, eventIds, {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    // 切り捨てて送ると、末尾の大会が一度も送られないまま送信済みになる。
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.failedGrades).toEqual(['A'])
    const rows = await testDb.select().from(eventGradeBroadcasts)
    expect(rows).toHaveLength(0)
  })

  it('束ねた本文が 5000 文字を超えても複数メッセージに分割して 1 リクエストで送る', async () => {
    await seedGradeBinding('A')
    const longTitle = 'あ'.repeat(190)
    const eventIds: number[] = []
    for (let i = 0; i < 30; i++) {
      const ev = await createEvent({ eligibleGrades: ['A'], title: `${longTitle}${i}` })
      eventIds.push(ev.id)
    }
    const fetchImpl = okFetch()

    const result = await broadcastEventsToGradeGroups(testDb, eventIds, {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    expect(result.sentGrades).toEqual(['A'])
    // リクエストは 1 回（retry key を共有するため分割してもリクエストは分けない）。
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchImpl)
    expect(body.messages.length).toBeGreaterThan(1)
    for (const m of body.messages) {
      expect(m.text.length).toBeLessThanOrEqual(5000)
    }
  })

  it('LINE が 409（同一 retry key で受理済み）を返したら送信成功として扱う', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    await seedGradeBinding('A')
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: false,
          status: 409,
          headers: { get: () => null },
          text: async () => 'conflict',
        }) as unknown as Response,
    )

    const result = await broadcastEventsToGradeGroups(testDb, [event.id], {
      fetchImpl,
      baseUrl: BASE_URL,
    })

    // 409 を失敗扱いにすると claim を巻き戻し、次回さらに送ろうとしてしまう。
    expect(result.sentGrades).toEqual(['A'])
    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows[0]!.sentAt).not.toBeNull()
  })

  // ─── review r1 should_fix: 添付なし配信は PUBLIC_BASE_URL に依存しない ───

  it('要綱添付が無い配信は PUBLIC_BASE_URL 未設定でも送れる', async () => {
    const event = await createEvent({
      eligibleGrades: ['A'],
      internalDeadline: '2031-07-25',
    })
    await seedGradeBinding('A')
    const fetchImpl = okFetch()

    // baseUrl を渡さず、env も未設定のまま（beforeEach で delete 済み）。
    const result = await broadcastEventsToGradeGroups(testDb, [event.id], { fetchImpl })

    expect(result.sentGrades).toEqual(['A'])
    const body = bodyOf(fetchImpl)
    expect(body.messages[0]!.text).toContain('締切')
    expect(body.messages[0]!.text).not.toContain('http')
  })
})
