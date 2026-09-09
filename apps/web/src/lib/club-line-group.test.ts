import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  lineChatTasks,
  membershipRenewals,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  listAvailableClubChatChannels,
  loadClubLineGroup,
  normalizeChatRoomName,
  parseOamRoomUrl,
  revertClubLineGroup,
  saveClubLineGroup,
} from './club-line-group'

const VALID_URL = 'https://chat.line.biz/U16c4a1b2c3d4e5f60718293a4b5c6d70/chat/C432c0102030405060708090a0b0c0d0e'

afterAll(async () => {
  await closeTestDb()
})

// `club_line_groups.updated_by` は users への FK なので、保存操作を通すには
// 操作者の行が実在している必要がある（FK 違反で INSERT ごと落ちる）。
const ADMIN_ID = 'admin-1'
/** 2 人目（更新者が入れ替わることの確認用）。 */
const ADMIN_ID_2 = 'admin-2'

beforeEach(async () => {
  await truncateAll()
  await testDb.insert(users).values([
    { id: ADMIN_ID, name: '管理者', role: 'admin' },
    { id: ADMIN_ID_2, name: '副管理者', role: 'vice_admin' },
  ])
})

async function seedChannel(
  note: string,
  overrides: {
    purpose?: 'system_notify' | 'event_broadcast' | 'grade_broadcast' | 'club_chat'
    status?: 'available' | 'assigned' | 'active' | 'system' | 'disabled'
    assignedEntryGroupId?: number | null
  } = {},
): Promise<number> {
  const [ch] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'tok',
      botId: `@${note}`,
      note,
      purpose: overrides.purpose ?? 'event_broadcast',
      status: overrides.status ?? 'available',
      assignedEntryGroupId: overrides.assignedEntryGroupId ?? null,
    })
    .returning({ id: lineChannels.id })
  return ch!.id
}

async function seedRenewal(
  fiscalYear: number,
  overrides: { status?: 'open' | 'completed' } = {},
): Promise<number> {
  const [row] = await testDb
    .insert(membershipRenewals)
    .values({
      fiscalYear,
      deadline: '2027-03-31',
      status: overrides.status ?? 'open',
    })
    .returning({ id: membershipRenewals.id })
  return row!.id
}

async function seedTask(
  renewalId: number,
  overrides: {
    kind?: 'announcement' | 'reminder'
    targetDate?: string
    splitIndex?: number
    status?:
      | 'PENDING'
      | 'RESERVING'
      | 'RESERVED'
      | 'FAILED'
      | 'MANUAL_REVIEW_REQUIRED'
      | 'DRY_RUN_SUCCEEDED'
      | 'CANCEL_PENDING'
      | 'CANCELLED'
    targetUserIds?: string[]
    errorCode?: string | null
    errorMessage?: string | null
    scheduledSendAt?: Date
  } = {},
): Promise<number> {
  const [row] = await testDb
    .insert(lineChatTasks)
    .values({
      renewalId,
      kind: overrides.kind ?? 'reminder',
      targetDate: overrides.targetDate ?? '2027-03-16',
      splitIndex: overrides.splitIndex ?? 0,
      scheduledSendAt: overrides.scheduledSendAt ?? new Date('2027-03-16T11:00:00Z'),
      messageText: 'テスト本文',
      status: overrides.status ?? 'PENDING',
      targetUserIds: overrides.targetUserIds ?? [],
      errorCode: overrides.errorCode ?? null,
      errorMessage: overrides.errorMessage ?? null,
    })
    .returning({ id: lineChatTasks.id })
  return row!.id
}

describe('parseOamRoomUrl', () => {
  it('正しい形式の URL からアカウントパスとルーム ID を取り出す', () => {
    const result = parseOamRoomUrl(VALID_URL)
    expect(result.oamAccountPath).toBe('U16c4a1b2c3d4e5f60718293a4b5c6d70')
    expect(result.oamChatRoomId).toBe('C432c0102030405060708090a0b0c0d0e')
  })

  it('末尾スラッシュや前後の空白を許容する', () => {
    const result = parseOamRoomUrl(`  ${VALID_URL}/  `)
    expect(result.oamChatRoomId).toBe('C432c0102030405060708090a0b0c0d0e')
  })

  it('ホスト名が違う URL を拒否する', () => {
    expect(() => parseOamRoomUrl(VALID_URL.replace('chat.line.biz', 'evil.example.com'))).toThrow(
      /形式が正しくありません/,
    )
  })

  it('アカウントパス・ルーム ID の桁数が違う URL を拒否する', () => {
    expect(() => parseOamRoomUrl('https://chat.line.biz/U123/chat/C432c0102030405060708090a0b0c0d0e')).toThrow(
      /形式が正しくありません/,
    )
  })

  it('URL として不正な文字列を拒否する', () => {
    expect(() => parseOamRoomUrl('not a url')).toThrow(/形式が正しくありません/)
  })
})

describe('normalizeChatRoomName', () => {
  it('末尾の半角括弧つき人数を取り除く', () => {
    const result = normalizeChatRoomName('令和8年度北海道大学かるた会 (67)')
    expect(result.name).toBe('令和8年度北海道大学かるた会')
    expect(result.strippedCount).toBe(true)
  })

  it('末尾の全角括弧つき人数を取り除く', () => {
    const result = normalizeChatRoomName('令和8年度北海道大学かるた会（67）')
    expect(result.name).toBe('令和8年度北海道大学かるた会')
    expect(result.strippedCount).toBe(true)
  })

  it('人数括弧が無ければ前後の空白だけ整える', () => {
    const result = normalizeChatRoomName('  令和8年度北海道大学かるた会  ')
    expect(result.name).toBe('令和8年度北海道大学かるた会')
    expect(result.strippedCount).toBe(false)
  })
})

describe('saveClubLineGroup — 初回作成（Bot 転換の CAS）', () => {
  it('available な Bot を club_chat へ転換し、club_line_groups を作成する', async () => {
    const channelId = await seedChannel('kagetra-club-bot-test')

    await saveClubLineGroup(
      { channelId, roomUrl: VALID_URL, chatRoomName: '令和8年度北海道大学かるた会 (67)' },
      ADMIN_ID,
    )

    const channel = await testDb.query.lineChannels.findFirst({ where: eq(lineChannels.id, channelId) })
    expect(channel?.purpose).toBe('club_chat')
    // review R2 blocker と同じ理由: status も available から外れていること。
    expect(channel?.status).not.toBe('available')

    const row = await testDb.query.clubLineGroups.findFirst()
    expect(row?.lineChannelId).toBe(channelId)
    expect(row?.oamAccountPath).toBe('U16c4a1b2c3d4e5f60718293a4b5c6d70')
    expect(row?.oamChatRoomId).toBe('C432c0102030405060708090a0b0c0d0e')
    // 人数括弧は保存前に除去される。
    expect(row?.chatRoomName).toBe('令和8年度北海道大学かるた会')
    expect(row?.updatedBy).toBe(ADMIN_ID)
  })

  it('available でない Bot を選ぶと失敗し、何も作成されない', async () => {
    const channelId = await seedChannel('kagetra-club-bot-busy', { status: 'assigned' })

    await expect(
      saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID),
    ).rejects.toThrow(/選び直してください/)

    const channel = await testDb.query.lineChannels.findFirst({ where: eq(lineChannels.id, channelId) })
    expect(channel?.purpose).toBe('event_broadcast')
    expect(channel?.status).toBe('assigned')

    const row = await testDb.query.clubLineGroups.findFirst()
    expect(row).toBeUndefined()
  })

  it('grade_broadcast へ転換済みの Bot は候補にならず失敗する', async () => {
    const channelId = await seedChannel('kagetra-club-bot-grade', {
      purpose: 'grade_broadcast',
      status: 'available',
    })

    await expect(
      saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID),
    ).rejects.toThrow(/選び直してください/)
  })

  it('channelId 未指定では作成できない', async () => {
    await expect(
      saveClubLineGroup({ channelId: null, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID),
    ).rejects.toThrow(/Bot を選択してください/)
  })

  it('URL が不正なら Bot は転換されない（副作用なし）', async () => {
    const channelId = await seedChannel('kagetra-club-bot-badurl')

    await expect(
      saveClubLineGroup({ channelId, roomUrl: 'not a url', chatRoomName: '会グループ' }, ADMIN_ID),
    ).rejects.toThrow(/形式が正しくありません/)

    const channel = await testDb.query.lineChannels.findFirst({ where: eq(lineChannels.id, channelId) })
    expect(channel?.purpose).toBe('event_broadcast')
    expect(channel?.status).toBe('available')
  })

  it('表示名が空（括弧だけ）なら拒否する', async () => {
    const channelId = await seedChannel('kagetra-club-bot-emptyname')

    await expect(
      saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '(67)' }, ADMIN_ID),
    ).rejects.toThrow(/グループ表示名を入力してください/)
  })
})

describe('saveClubLineGroup — 設定済みの更新', () => {
  it('Bot には触れず、URL と表示名だけを更新する', async () => {
    const channelId = await seedChannel('kagetra-club-bot-existing')
    await saveClubLineGroup(
      { channelId, roomUrl: VALID_URL, chatRoomName: '旧グループ名' },
      ADMIN_ID,
    )

    const otherUrl =
      'https://chat.line.biz/U16c4a1b2c3d4e5f60718293a4b5c6d70/chat/Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    // channelId は別値（誤送信）を渡しても既存行があれば無視される。
    await saveClubLineGroup(
      { channelId: 99999, roomUrl: otherUrl, chatRoomName: '新グループ名' },
      ADMIN_ID_2,
    )

    const rows = await testDb.select().from(clubLineGroups)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.lineChannelId).toBe(channelId)
    expect(rows[0]!.chatRoomName).toBe('新グループ名')
    expect(rows[0]!.oamChatRoomId).toBe('Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(rows[0]!.updatedBy).toBe(ADMIN_ID_2)
  })
})

describe('revertClubLineGroup', () => {
  async function seedConfigured(): Promise<number> {
    const channelId = await seedChannel('kagetra-club-bot-revert')
    await saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID)
    return channelId
  }

  it('進行中の年度確認・未終了タスクが無ければプールへ戻す', async () => {
    const channelId = await seedConfigured()

    await revertClubLineGroup()

    const channel = await testDb.query.lineChannels.findFirst({ where: eq(lineChannels.id, channelId) })
    expect(channel?.purpose).toBe('event_broadcast')
    expect(channel?.status).toBe('available')

    const row = await testDb.query.clubLineGroups.findFirst()
    expect(row).toBeUndefined()
  })

  it('進行中(open)の年度確認があれば拒否する', async () => {
    const channelId = await seedConfigured()
    await seedRenewal(2027, { status: 'open' })

    await expect(revertClubLineGroup()).rejects.toThrow(/進行中の年度確認/)

    const channel = await testDb.query.lineChannels.findFirst({ where: eq(lineChannels.id, channelId) })
    expect(channel?.purpose).toBe('club_chat')
    const row = await testDb.query.clubLineGroups.findFirst()
    expect(row).not.toBeUndefined()
  })

  it('completed の年度確認は妨げにならない', async () => {
    await seedConfigured()
    await seedRenewal(2027, { status: 'completed' })

    await expect(revertClubLineGroup()).resolves.toBeUndefined()
  })

  it.each(['PENDING', 'RESERVING', 'CANCEL_PENDING'] as const)(
    '未終了タスク(%s)が残っていれば拒否する',
    async (status) => {
      await seedConfigured()
      const renewalId = await seedRenewal(2027, { status: 'completed' })
      await seedTask(renewalId, { status })

      await expect(revertClubLineGroup()).rejects.toThrow(/未完了の送信タスク/)
    },
  )

  it.each(['RESERVED', 'FAILED', 'MANUAL_REVIEW_REQUIRED', 'DRY_RUN_SUCCEEDED', 'CANCELLED'] as const)(
    '完了・失敗・取消済みタスク(%s)は妨げにならない',
    async (status) => {
      await seedConfigured()
      const renewalId = await seedRenewal(2027, { status: 'completed' })
      await seedTask(renewalId, { status })

      await expect(revertClubLineGroup()).resolves.toBeUndefined()
    },
  )

  it('未設定の状態で呼ぶと拒否する', async () => {
    await expect(revertClubLineGroup()).rejects.toThrow(/設定されていません/)
  })
})

describe('loadClubLineGroup / listAvailableClubChatChannels', () => {
  it('未設定なら null を返す', async () => {
    await expect(loadClubLineGroup()).resolves.toBeNull()
  })

  it('設定済みなら Bot ラベル・グループ情報・直近タスクを返す（分割合計込み）', async () => {
    const channelId = await seedChannel('kagetra-club-bot-view')
    await saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID)
    const renewalId = await seedRenewal(2027, { status: 'open' })

    // 同じ日のリマインドを 2 分割 + 取消済み 1 件（分割合計には数えない）。
    await seedTask(renewalId, {
      splitIndex: 0,
      status: 'RESERVED',
      targetUserIds: ['u1', 'u2'],
      scheduledSendAt: new Date('2027-03-16T11:00:00Z'),
    })
    await seedTask(renewalId, {
      splitIndex: 1,
      status: 'FAILED',
      targetUserIds: ['u3'],
      errorCode: 'LINE_AUTH_EXPIRED',
      errorMessage: 'ログイン画面を検出',
      scheduledSendAt: new Date('2027-03-16T11:10:00Z'),
    })
    await seedTask(renewalId, {
      splitIndex: 2,
      status: 'CANCELLED',
      scheduledSendAt: new Date('2027-03-16T11:20:00Z'),
    })

    const view = await loadClubLineGroup()
    expect(view?.channelId).toBe(channelId)
    expect(view?.botLabel).toContain('kagetra-club-bot-view')
    expect(view?.lineGroupId).toBeNull()

    const reminders = view!.tasks.filter((t) => t.status !== 'CANCELLED')
    expect(reminders).toHaveLength(2)
    for (const task of reminders) {
      expect(task.splitTotal).toBe(2)
    }
    const failed = view!.tasks.find((t) => t.status === 'FAILED')
    expect(failed?.errorCode).toBe('LINE_AUTH_EXPIRED')
    expect(failed?.targetUserCount).toBe(1)
    // 送信予定が未来の FAILED は再試行可能（R10「送信予定が未来の場合のみ」）。
    expect(failed?.retryable).toBe(true)
  })

  it('送信予定を過ぎた FAILED は retryable=false になる（R10）', async () => {
    const channelId = await seedChannel('kagetra-club-bot-view-past')
    await saveClubLineGroup({ channelId, roomUrl: VALID_URL, chatRoomName: '会グループ' }, ADMIN_ID)
    const renewalId = await seedRenewal(2027, { status: 'open' })
    await seedTask(renewalId, {
      status: 'FAILED',
      scheduledSendAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    const view = await loadClubLineGroup()
    const failed = view!.tasks.find((t) => t.status === 'FAILED')
    expect(failed?.retryable).toBe(false)
  })

  it('event_broadcast/available/未割当 の Bot だけを候補として列挙する', async () => {
    const available = await seedChannel('kagetra-club-bot-avail')
    const busy = await seedChannel('kagetra-club-bot-busy', { status: 'assigned' })
    const alreadyGrade = await seedChannel('kagetra-club-bot-grade', {
      purpose: 'grade_broadcast',
      status: 'available',
    })

    const rows = await listAvailableClubChatChannels()
    const ids = rows.map((r) => r.id)
    expect(ids).toEqual([available])
    expect(ids).not.toContain(busy)
    expect(ids).not.toContain(alreadyGrade)
    expect(rows[0]!.label).toContain('kagetra-club-bot-avail')
  })
})
