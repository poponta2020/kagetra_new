import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { lineChannels, lineGradeGroupBindings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { generateGradeInviteCode, revokeGradeBinding } = await import('./actions')

const ADMIN = { id: 'admin-1', role: 'admin' as const }
const VICE_ADMIN = { id: 'vice-1', role: 'vice_admin' as const }
const MEMBER = { id: 'member-1', role: 'member' as const }

afterAll(async () => {
  await closeTestDb()
})

async function seedChannel(
  note: string,
  overrides: {
    purpose?: 'system_notify' | 'event_broadcast' | 'grade_broadcast'
    status?: 'available' | 'assigned' | 'active' | 'system' | 'disabled'
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
    })
    .returning({ id: lineChannels.id })
  return ch!.id
}

async function seedAvailableChannel(note = 'kagetra-grade-bot-test'): Promise<number> {
  return seedChannel(note)
}

beforeEach(async () => {
  await truncateAll()
  await setAuthSession(ADMIN)
})

describe('generateGradeInviteCode', () => {
  it('プールから event_broadcast チャネルを確保し grade_broadcast へ転換する', async () => {
    const channelId = await seedAvailableChannel()

    const result = await generateGradeInviteCode('A')

    expect(result.inviteCode).toMatch(/^\d{6}$/)
    expect(result.addFriendUrl).toContain(encodeURIComponent('@kagetra-grade-bot-test'))

    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.purpose).toBe('grade_broadcast')

    const binding = await testDb.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.grade, 'A'),
    })
    expect(binding?.lineChannelId).toBe(channelId)
    expect(binding?.status).toBe('invite_pending')
    expect(binding?.inviteCode).toBe(result.inviteCode)
  })

  it('プール枯渇時（available な event_broadcast チャネルが無い）はエラーになる', async () => {
    // どれも「available な event_broadcast チャネル」の条件を満たさない:
    // status が available でない・既に grade_broadcast へ転換済み。
    await seedChannel('kagetra-grade-bot-assigned', { status: 'assigned' })
    await seedChannel('kagetra-grade-bot-active', { status: 'active' })
    await seedChannel('kagetra-grade-bot-already-grade', {
      purpose: 'grade_broadcast',
      status: 'available',
    })

    await expect(generateGradeInviteCode('B')).rejects.toThrow(/プール/)
  })

  it('既存行がある級は同一チャネルを再利用し、新規行を作らない（AC-20: grade UNIQUE）', async () => {
    const channelId = await seedAvailableChannel()
    await generateGradeInviteCode('C')

    const second = await generateGradeInviteCode('C')

    expect(second.inviteCode).toMatch(/^\d{6}$/)
    // Same channel reused, not a second pool channel claimed.
    const bindings = await testDb
      .select()
      .from(lineGradeGroupBindings)
      .where(eq(lineGradeGroupBindings.grade, 'C'))
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.lineChannelId).toBe(channelId)
    // Re-issue updated the same row in place with the new code.
    expect(bindings[0]!.inviteCode).toBe(second.inviteCode)
  })

  // review r1 blocker: 紐付け済みの級で再発行を許すと、確認なしの1操作で
  // その級が配信対象から外れる（以後の大会案内が丸ごと届かなくなる）。
  it('紐付け済み(linked)の級では再発行を拒否し、紐付けを壊さない', async () => {
    const channelId = await seedAvailableChannel()
    await generateGradeInviteCode('C')
    await testDb
      .update(lineGradeGroupBindings)
      .set({ status: 'linked', lineGroupId: 'G-C', linkedAt: sql`now()` })
      .where(eq(lineGradeGroupBindings.grade, 'C'))

    await expect(generateGradeInviteCode('C')).rejects.toThrow(
      /解除してから再発行/,
    )

    const binding = await testDb.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.grade, 'C'),
    })
    expect(binding?.status).toBe('linked')
    expect(binding?.lineGroupId).toBe('G-C')
    expect(binding?.linkedAt).not.toBeNull()
    expect(binding?.lineChannelId).toBe(channelId)
  })

  it('解除してからなら再発行できる（同一行を再利用）', async () => {
    await seedAvailableChannel()
    await generateGradeInviteCode('C')
    await testDb
      .update(lineGradeGroupBindings)
      .set({ status: 'linked', lineGroupId: 'G-C', linkedAt: sql`now()` })
      .where(eq(lineGradeGroupBindings.grade, 'C'))

    await revokeGradeBinding('C')
    const reissued = await generateGradeInviteCode('C')

    expect(reissued.inviteCode).toMatch(/^\d{6}$/)
    const bindings = await testDb
      .select()
      .from(lineGradeGroupBindings)
      .where(eq(lineGradeGroupBindings.grade, 'C'))
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.status).toBe('invite_pending')
  })

  it('DB 層でも同じ級に 2 行を作れない（grade UNIQUE 制約）', async () => {
    const channelId1 = await seedAvailableChannel('kagetra-grade-bot-1')
    const channelId2 = await seedAvailableChannel('kagetra-grade-bot-2')
    await testDb.insert(lineGradeGroupBindings).values({
      grade: 'D',
      lineChannelId: channelId1,
      status: 'invite_pending',
    })

    await expect(
      testDb.insert(lineGradeGroupBindings).values({
        grade: 'D',
        lineChannelId: channelId2,
        status: 'invite_pending',
      }),
    ).rejects.toThrow()
  })

  it('vice_admin は実行できない', async () => {
    await seedAvailableChannel()
    await setAuthSession(VICE_ADMIN)
    await expect(generateGradeInviteCode('A')).rejects.toThrow(/Forbidden/)
  })

  it('member は実行できない', async () => {
    await seedAvailableChannel()
    await setAuthSession(MEMBER)
    await expect(generateGradeInviteCode('A')).rejects.toThrow(/Forbidden/)
  })

  it('未ログインは実行できない', async () => {
    await seedAvailableChannel()
    await setAuthSession(null)
    await expect(generateGradeInviteCode('A')).rejects.toThrow(/Forbidden/)
  })

  it('grade_broadcast へ転換したチャネルは /admin/line-channels の一覧（purpose=event_broadcast）に出ない（AC-25 回帰）', async () => {
    const channelId = await seedAvailableChannel()
    await generateGradeInviteCode('E')

    const eventBroadcastChannels = await testDb
      .select({ id: lineChannels.id })
      .from(lineChannels)
      .where(eq(lineChannels.purpose, 'event_broadcast'))

    expect(eventBroadcastChannels.map((row) => row.id)).not.toContain(channelId)
  })
})

describe('revokeGradeBinding', () => {
  it('解除後は status=linked AND line_group_id IS NOT NULL の配信対象クエリに出てこない（AC-19）', async () => {
    const channelId = await seedAvailableChannel()
    // binding を直接 INSERT するので、招待コード発行で起きるチャネル転換
    // (event_broadcast → grade_broadcast) も手で再現しておく。ここを省くと
    // 「revoke してもプールへ戻さない」の assertion が、そもそも転換されて
    // いない初期値を見ているだけになる。
    await testDb
      .update(lineChannels)
      .set({ purpose: 'grade_broadcast' })
      .where(eq(lineChannels.id, channelId))
    await testDb.insert(lineGradeGroupBindings).values({
      grade: 'A',
      lineChannelId: channelId,
      status: 'linked',
      lineGroupId: 'Cgroup123',
      linkedAt: sql`now()`,
    })

    await revokeGradeBinding('A')

    const broadcastTargets = await testDb
      .select()
      .from(lineGradeGroupBindings)
      .where(
        and(
          eq(lineGradeGroupBindings.status, 'linked'),
          isNotNull(lineGradeGroupBindings.lineGroupId),
        ),
      )
    expect(broadcastTargets).toHaveLength(0)

    const binding = await testDb.query.lineGradeGroupBindings.findFirst({
      where: eq(lineGradeGroupBindings.grade, 'A'),
    })
    expect(binding?.status).toBe('revoked')
    expect(binding?.inviteCode).toBeNull()
    expect(binding?.inviteCodeExpiresAt).toBeNull()

    // line_channels はプールへ戻さず grade_broadcast のまま残る。
    const channel = await testDb.query.lineChannels.findFirst({
      where: eq(lineChannels.id, channelId),
    })
    expect(channel?.purpose).toBe('grade_broadcast')
  })

  it('vice_admin は実行できない', async () => {
    const channelId = await seedAvailableChannel()
    await testDb.insert(lineGradeGroupBindings).values({
      grade: 'A',
      lineChannelId: channelId,
      status: 'linked',
      lineGroupId: 'Cgroup123',
      linkedAt: sql`now()`,
    })
    await setAuthSession(VICE_ADMIN)
    await expect(revokeGradeBinding('A')).rejects.toThrow(/Forbidden/)
  })

  it('member は実行できない', async () => {
    await setAuthSession(MEMBER)
    await expect(revokeGradeBinding('A')).rejects.toThrow(/Forbidden/)
  })

  it('未ログインは実行できない', async () => {
    await setAuthSession(null)
    await expect(revokeGradeBinding('A')).rejects.toThrow(/Forbidden/)
  })
})
