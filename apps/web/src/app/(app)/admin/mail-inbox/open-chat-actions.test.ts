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
