import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroupOpenChatBroadcasts,
  entryGroupOpenChats,
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  entryGroups,
  lineChannels,
  mailAttachments,
  mailMessages,
  users,
} from '@kagetra/shared/schema'
import { db } from '@/lib/db'

/**
 * openchat-broadcast タスク8: Server Action のテスト。
 *
 * ★このファイルの中心は **AC-40 / AC-41** — オープンチャット配信が
 * `event_broadcast_messages` に行を作らないこと、および同一メールから2回配信しても
 * DB 制約違反にならないこと。既存のメール配信は同テーブルの
 * UNIQUE(event_line_broadcast_id, mail_message_id) で「1メール=1配信」を強制しており、
 * オープンチャット側がそこへ書くと再配信が原理的に不可能になる（requirements §6）。
 */

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/**
 * push だけを差し替える。既定は実物（`LINE_NOTIFY_DRY_RUN=1` により送信せず成功）で、
 * 失敗パスのテストだけが `mockPushMessages` を上書きする。
 *
 * ★これが無いと `pushResult.error` の分岐（復旧呼び出し・failed 履歴の記録・
 * 保存済みデータの生存）が**一度も実行されない**まま AC-38 を green と誤認する。
 */
const mockPushMessages = vi.hoisted(() => vi.fn())
/**
 * 「binding を読んだ後・push する前に紐付けが変わった」状況は、その2点の間に
 * 割り込む手段が本番コードに無い（あってはならない）ため、verdict をここで
 * 差し替えて再現する。既定は実物。
 */
const mockAssertBinding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/line-broadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/line-broadcast')>()
  return {
    ...actual,
    pushMessages: mockPushMessages,
    assertBindingUnchangedByEntryGroup: mockAssertBinding,
  }
})

const {
  pushMessages: realPushMessages,
  assertBindingUnchangedByEntryGroup: realAssertBinding,
} = await vi.importActual<typeof import('@/lib/line-broadcast')>('@/lib/line-broadcast')

const {
  broadcastOpenChats,
  listOpenChatsForGroup,
  loadOpenChatBroadcastSummary,
  saveAndBroadcastOpenChats,
} = await import('./open-chat-actions')

async function resetDb() {
  await db.delete(entryGroupOpenChatBroadcasts)
  await db.delete(entryGroupOpenChats)
  await db.delete(eventBroadcastMessages)
  await db.delete(eventLineBroadcasts)
  await db.delete(lineChannels)
  await db.delete(mailAttachments)
  await db.delete(mailMessages)
  await db.delete(events)
  await db.delete(entryGroups)
  await db.delete(users)
}

let originalDryRun: string | undefined

beforeAll(() => {
  // push は実行せず成功扱いにする（既存 line-broadcast.test.ts と同じ流儀）。
  originalDryRun = process.env.LINE_NOTIFY_DRY_RUN
  process.env.LINE_NOTIFY_DRY_RUN = '1'
})

afterAll(() => {
  if (originalDryRun === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
  else process.env.LINE_NOTIFY_DRY_RUN = originalDryRun
})

beforeEach(async () => {
  await resetDb()
  mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
  // 既定は実物（DRY_RUN で送信せず成功）。失敗パスのテストだけが上書きする。
  // ★mockReset で**呼び出し履歴も**捨てる — mockImplementation だけだと履歴が
  // テスト間で累積し、`not.toHaveBeenCalled()` が前のテストの分で落ちる。
  mockPushMessages.mockReset()
  mockPushMessages.mockImplementation(realPushMessages)
  mockAssertBinding.mockReset()
  mockAssertBinding.mockImplementation(realAssertBinding)
})

async function seedAdminUser() {
  await db.insert(users).values({ id: 'admin-1', name: '管理者', role: 'admin' })
}

/** グループ + 2日ぶんの events を作る。 */
async function seedGroup(dates: string[] = ['2026-06-20', '2026-06-21']) {
  const group = (await db.insert(entryGroups).values({}).returning())[0]!
  for (const [i, eventDate] of dates.entries()) {
    await db.insert(events).values({
      title: `テスト大会${i === 0 ? 'A' : 'B'}`,
      eventDate,
      kind: 'individual',
      entryGroupId: group.id,
    })
  }
  return group.id
}

/** グループに linked な LINE 紐付けを作る。 */
async function seedBinding(entryGroupId: number) {
  const channel = (
    await db
      .insert(lineChannels)
      .values({
        channelId: `ch-oc-${Math.random().toString(36).slice(2, 10)}`,
        channelSecret: 'secret',
        channelAccessToken: 'token',
        botId: '@kagetra-oc-test',
        purpose: 'event_broadcast',
        status: 'active',
        assignedEntryGroupId: entryGroupId,
      })
      .returning()
  )[0]!
  await db.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel.id,
    status: 'linked',
    lineGroupId: 'C123456789',
    linkedAt: new Date(),
  })
  return channel
}

async function seedMail() {
  const mail = (
    await db
      .insert(mailMessages)
      .values({
        messageId: `oc-${Math.random().toString(36).slice(2, 10)}`,
        subject: 'オープンチャットのご案内',
        fromAddress: 'organizer@example.com',
        toAddresses: ['club@example.com'],
        receivedAt: new Date(),
        bodyText: 'https://line.me/ti/g2/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      })
      .returning()
  )[0]!
  return mail.id
}

function row(overrides: Partial<Parameters<typeof saveAndBroadcastOpenChats>[0]['rows'][0]> = {}) {
  return {
    url: 'https://line.me/ti/g2/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    grades: null,
    eventDate: null,
    label: null,
    password: null,
    source: 'body' as const,
    ...overrides,
  }
}

describe('認可（AC-44）', () => {
  it('未ログインでは拒否される', async () => {
    mockAuth.mockResolvedValue(null)
    const groupId = await seedGroup()
    await expect(
      saveAndBroadcastOpenChats({ entryGroupId: groupId, mailMessageId: null, rows: [row()] }),
    ).rejects.toThrow('Unauthorized')
  })

  it('一般会員では拒否される', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'member' } })
    const groupId = await seedGroup()
    await expect(
      saveAndBroadcastOpenChats({ entryGroupId: groupId, mailMessageId: null, rows: [row()] }),
    ).rejects.toThrow('Forbidden')
  })

  it('vice_admin は許可される', async () => {
    await db.insert(users).values({ id: 'vice-1', name: '副管理者', role: 'vice_admin' })
    mockAuth.mockResolvedValue({ user: { id: 'vice-1', role: 'vice_admin' } })
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })
    expect(result.ok).toBe(true)
  })

  it('一般会員は配信 Action も直接叩けない', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'member' } })
    const groupId = await seedGroup()
    await expect(broadcastOpenChats({ entryGroupId: groupId })).rejects.toThrow('Forbidden')
  })
})

describe('バリデーション', () => {
  beforeEach(seedAdminUser)

  it('AC-28: URL 空欄では保存できない', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ url: '' })],
    })
    expect(result.ok).toBe(false)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(0)
  })

  it('AC-26: https 以外のスキームは保存できない', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ url: 'http://line.me/ti/g2/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' })],
    })
    expect(result.ok).toBe(false)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(0)
  })

  it('AC-27: グループ外の開催日は保存できない', async () => {
    const groupId = await seedGroup(['2026-06-20', '2026-06-21'])
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ eventDate: '2026-07-05' })],
    })
    expect(result.ok).toBe(false)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(0)
  })

  it('グループ内の開催日は保存できる', async () => {
    const groupId = await seedGroup(['2026-06-20', '2026-06-21'])
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ eventDate: '2026-06-20' })],
    })
    expect(result.ok).toBe(true)
  })

  it('AC-25: 同一 URL を2行に入れると保存されない', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ grades: ['C'] }), row({ grades: ['D'] })],
    })
    expect(result.ok).toBe(false)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(0)
  })

  it('AC-25: 既存行と同じ URL を後から保存しても弾かれる（DB の UNIQUE が正）', async () => {
    const groupId = await seedGroup()
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })
    const second = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ grades: ['C'] })],
    })
    expect(second.ok).toBe(false)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)
  })

  it('AC-47/48: 最終ラベルが重複する行があると保存できず、重複行が返る', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [
        row({ url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
        row({ url: 'https://line.me/ti/g2/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }),
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.duplicateLabelIndexes).toEqual([0, 1])
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(0)
  })

  it('AC-49: 自由ラベルで重複を解消すると保存できる', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [
        row({ url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', label: '団体戦' }),
        row({ url: 'https://line.me/ti/g2/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', label: '1年の部' }),
      ],
    })
    expect(result.ok).toBe(true)
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(2)
  })
})

describe('保存と配信', () => {
  beforeEach(seedAdminUser)

  it('AC-37: LINE 未紐付けでは保存のみ行い配信しない', async () => {
    const groupId = await seedGroup()
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })
    expect(result.ok && result.broadcast.status).toBe('not_linked')
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)
    // 配信していないので履歴も残らない（N 回配信済みのカウントを汚さない）。
    await expect(db.select().from(entryGroupOpenChatBroadcasts)).resolves.toHaveLength(0)
  })

  it('紐付けがあれば保存して配信し、履歴が1件残る', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })
    expect(result.ok && result.broadcast.status).toBe('sent')
    const history = await db.select().from(entryGroupOpenChatBroadcasts)
    expect(history).toHaveLength(1)
    expect(history[0]?.sentCount).toBe(1)
    expect(history[0]?.status).toBe('sent')
  })

  it('AC-40: オープンチャット配信は event_broadcast_messages に行を作らない', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    const mailId = await seedMail()

    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: mailId,
      rows: [row()],
    })

    // ★これが requirements §6 の契約。既存のメール配信の冪等性を汚さない。
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })

  it('AC-41: 同一メールから2回配信しても DB 制約違反にならず2回とも成功する', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    const mailId = await seedMail()

    const first = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: mailId,
      rows: [row()],
    })
    expect(first.ok && first.broadcast.status).toBe('sent')

    // 2回目は「毎回全件を送る」再配信。event_broadcast_messages を使っていたら
    // UNIQUE(event_line_broadcast_id, mail_message_id) で落ちるケース。
    const second = await broadcastOpenChats({ entryGroupId: groupId })
    expect(second.status).toBe('sent')

    await expect(db.select().from(entryGroupOpenChatBroadcasts)).resolves.toHaveLength(2)
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })

  it('AC-38: 配信が失敗しても保存済みデータは残り、再試行できる', async () => {
    const groupId = await seedGroup()
    const channel = await seedBinding(groupId)
    const mailId = await seedMail()

    mockPushMessages.mockResolvedValue({
      deliveredCount: 0,
      error: new Error('LINE API 400'),
      httpStatus: 400,
    })

    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: mailId,
      rows: [row()],
    })

    // 保存は成功・配信は失敗として分けて返る（保存をロールバックしない）。
    expect(result.ok).toBe(true)
    expect(result.ok && result.broadcast.status).toBe('failed')
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)

    const history = await db.select().from(entryGroupOpenChatBroadcasts)
    expect(history).toHaveLength(1)
    expect(history[0]?.status).toBe('failed')
    expect(history[0]?.sentCount).toBe(0)

    // ★失敗パスでも event_broadcast_messages に触れない（§6 の契約）。
    // 復旧処理を将来いじったときに一番踏みやすいのがここ。
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)

    // 4xx なので binding は revoke され channel はプールへ戻る（既存の復旧規約）。
    const [broadcastRow] = await db.select().from(eventLineBroadcasts)
    expect(broadcastRow?.status).toBe('revoked')
    const [channelRow] = await db
      .select()
      .from(lineChannels)
      .where(eq(lineChannels.id, channel.id))
    expect(channelRow?.status).toBe('available')

    // 保存済みデータが残っているので再試行できる（紐付け直後に再配信可能）。
    await db.delete(entryGroupOpenChatBroadcasts)
    await db.update(eventLineBroadcasts).set({ status: 'linked' })
    mockPushMessages.mockImplementation(realPushMessages)
    await expect(broadcastOpenChats({ entryGroupId: groupId })).resolves.toEqual({
      status: 'sent',
      sentCount: 1,
    })
  })

  it('AC-38: push が 401 でも保存は残り、failed 履歴が1件だけ増える', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)

    mockPushMessages.mockResolvedValue({
      deliveredCount: 0,
      error: new Error('invalid token'),
      httpStatus: 401,
    })

    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })

    expect(result.ok && result.broadcast.status).toBe('failed')
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)
    await expect(db.select().from(entryGroupOpenChatBroadcasts)).resolves.toHaveLength(1)
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })

  it('AC-39: 配信直前に紐付けが解除されていたら配信を中止する', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })
    await db.delete(entryGroupOpenChatBroadcasts)

    // 紐付けを解除してから再配信する。
    await db.update(eventLineBroadcasts).set({ status: 'revoked' })

    const result = await broadcastOpenChats({ entryGroupId: groupId })
    // 紐付けが消えているので not_linked（binding をそもそも取得できない）。
    expect(result.status).toBe('not_linked')
    // 保存済みデータは残る（AC-38）。
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)
  })

  it('AC-39: 送信中に紐付けが差し替わっていたら push せず skipped を記録する', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    // binding は読めるが、push 直前の再検証で「変わっている」と判定される状況。
    mockAssertBinding.mockResolvedValue({ changed: true, current: null })

    const result = await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row()],
    })

    expect(result.ok && result.broadcast.status).toBe('binding_changed')
    // 失効した groupId / token へ送っていない。
    expect(mockPushMessages).not.toHaveBeenCalled()
    // 保存は残る。
    await expect(listOpenChatsForGroup(groupId)).resolves.toHaveLength(1)

    const history = await db.select().from(entryGroupOpenChatBroadcasts)
    expect(history).toHaveLength(1)
    expect(history[0]?.status).toBe('skipped')
    expect(history[0]?.errorMessage).toBe('binding_changed')
    expect(history[0]?.sentCount).toBe(0)
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })

  it('AC-29/AC-52: 保存はグループに紐付き、表示順は sort_order 昇順で安定する', async () => {
    const groupId = await seedGroup()
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [
        row({ url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grades: ['B'] }),
        row({ url: 'https://line.me/ti/g2/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', grades: ['C'] }),
      ],
    })
    // 追記しても既存の並びが崩れない。
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ url: 'https://line.me/ti/g2/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', grades: ['D'] })],
    })

    const rows = await listOpenChatsForGroup(groupId)
    expect(rows.map((r) => r.grades)).toEqual([['B'], ['C'], ['D']])
  })
})

describe('再配信サマリー（AC-35, AC-53）', () => {
  beforeEach(seedAdminUser)

  it('初回は配信回数0で、（今回追加）印は付かない', async () => {
    const groupId = await seedGroup()
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ grades: ['C'] })],
    })
    const summary = await loadOpenChatBroadcastSummary(groupId)
    expect(summary.broadcastCount).toBe(0)
    expect(summary.rows.map((r) => r.isNew)).toEqual([false])
    expect(summary.rows.map((r) => r.label)).toEqual(['C級'])
  })

  it('2回目は配信済み回数と、前回以降に増えた行への（今回追加）印が返る', async () => {
    const groupId = await seedGroup()
    await seedBinding(groupId)
    await saveAndBroadcastOpenChats({
      entryGroupId: groupId,
      mailMessageId: null,
      rows: [row({ url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grades: ['C'] })],
    })

    // 配信後に増えた行。created_at > 直近の sent_at になる。
    await new Promise((resolve) => setTimeout(resolve, 10))
    await saveAndBroadcastOpenChats(
      {
        entryGroupId: groupId,
        mailMessageId: null,
        rows: [
          row({ url: 'https://line.me/ti/g2/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', grades: ['D'] }),
        ],
      },
      { broadcast: false },
    )

    const summary = await loadOpenChatBroadcastSummary(groupId)
    expect(summary.broadcastCount).toBe(1)
    expect(summary.rows.map((r) => r.label)).toEqual(['C級', 'D級'])
    expect(summary.rows.map((r) => r.isNew)).toEqual([false, true])
  })
})
