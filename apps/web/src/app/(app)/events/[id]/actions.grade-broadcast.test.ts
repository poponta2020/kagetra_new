import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventGradeBroadcasts,
  lineChannels,
  lineGradeGroupBindings,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// event-grade-group-broadcast タスク5: 再送は「未送信の級だけに送る」を
// コアロジックの claim にそのまま任せる設計なので、ここは配線ではなく
// **実物のコアロジック + 実 DB** で検証する（claim を自前で再実装していない
// ことの証明になる）。実 push だけ LINE_NOTIFY_DRY_RUN で止める。
const { resendGradeBroadcast } = await import('./actions')

const ADMIN = { id: 'admin-1', role: 'admin' as const }
const VICE_ADMIN = { id: 'vice-1', role: 'vice_admin' as const }
const MEMBER = { id: 'member-1', role: 'member' as const }

// review R2 should_fix: 退避はモジュール初期化時に**一度だけ**行う。beforeEach で
// 退避すると 2 回目以降は自分が設定した値を保存してしまい、afterAll が元の値では
// なく '1' / 'https://example.test' を残す。同じ vitest worker で後続ファイルの
// push テストが order-dependent になる。
const savedDryRun = process.env.LINE_NOTIFY_DRY_RUN
const savedBaseUrl = process.env.PUBLIC_BASE_URL

beforeEach(async () => {
  await truncateAll()
  await setAuthSession(ADMIN)
  process.env.LINE_NOTIFY_DRY_RUN = '1'
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

afterAll(async () => {
  if (savedDryRun === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
  else process.env.LINE_NOTIFY_DRY_RUN = savedDryRun
  if (savedBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = savedBaseUrl
  await closeTestDb()
})

async function seedLinkedGradeGroup(grade: 'A' | 'B' | 'C' | 'D' | 'E') {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-grade-${grade}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: `@bot-${grade}`,
      purpose: 'grade_broadcast',
      status: 'active',
    })
    .returning({ id: lineChannels.id })
  await testDb.insert(lineGradeGroupBindings).values({
    grade,
    lineChannelId: channel!.id,
    status: 'linked',
    lineGroupId: `G-${grade}`,
  })
}

describe('resendGradeBroadcast', () => {
  it('未送信の級へ送信し、送信済みとして記録される', async () => {
    await seedLinkedGradeGroup('B')
    const event = await createEvent({ eligibleGrades: ['B'] })

    await expect(resendGradeBroadcast(event.id)).resolves.toBeUndefined()

    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.grade).toBe('B')
    expect(rows[0]!.sentAt).not.toBeNull()
  })

  it('送信済みの級には再送せず、sent_at も書き換えない（AC-21）', async () => {
    await seedLinkedGradeGroup('B')
    const event = await createEvent({ eligibleGrades: ['B'] })

    // 1 回目で送信済みにする。
    await resendGradeBroadcast(event.id)
    const first = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    const firstSentAt = first[0]!.sentAt

    // 2 回目は送る対象が無いのでエラーで返る（UI に「未送信の級がありません」）。
    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(
      /未送信の級がありません/,
    )

    const second = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(second).toHaveLength(1)
    expect(second[0]!.sentAt).toEqual(firstSentAt)
  })

  it('一部の級だけ送信済みなら、未送信の級にだけ送る（AC-21）', async () => {
    await seedLinkedGradeGroup('B')
    await seedLinkedGradeGroup('C')
    const event = await createEvent({ eligibleGrades: ['B', 'C'] })

    // B だけ送信済みの状態を作る。
    await testDb
      .insert(eventGradeBroadcasts)
      .values({ eventId: event.id, grade: 'B', sentAt: new Date() })

    await expect(resendGradeBroadcast(event.id)).resolves.toBeUndefined()

    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.sentAt != null)).toBe(true)
  })

  it('紐付け済みの級が1つも無ければエラーになる（配信対象なし）', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })

    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(
      /紐付け済みの級グループがありません/,
    )
  })

  it('revoked の級は配信対象から外れる（AC-19）', async () => {
    await seedLinkedGradeGroup('B')
    await testDb
      .update(lineGradeGroupBindings)
      .set({ status: 'revoked' })
      .where(eq(lineGradeGroupBindings.grade, 'B'))
    const event = await createEvent({ eligibleGrades: ['B'] })

    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(
      /紐付け済みの級グループがありません/,
    )
    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(0)
  })

  // AC-22: 再送は admin のみ。vice_admin を通してはならない
  // （このファイルの近傍にある requireAdminSession は vice_admin を通すため、
  //  それを流用していたらここで落ちる）。
  it('vice_admin は実行できない（AC-22）', async () => {
    await seedLinkedGradeGroup('B')
    const event = await createEvent({ eligibleGrades: ['B'] })
    await setAuthSession(VICE_ADMIN)
    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(/Forbidden/)

    const rows = await testDb
      .select()
      .from(eventGradeBroadcasts)
      .where(eq(eventGradeBroadcasts.eventId, event.id))
    expect(rows).toHaveLength(0)
  })

  it('member は実行できない（AC-22）', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })
    await setAuthSession(MEMBER)
    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(/Forbidden/)
  })

  it('未ログインは実行できない（AC-22）', async () => {
    const event = await createEvent({ eligibleGrades: ['B'] })
    await setAuthSession(null)
    await expect(resendGradeBroadcast(event.id)).rejects.toThrow(/Forbidden/)
  })
})

// AC-15「大会情報を編集しても再配信は行われない」。編集は edit/page.tsx の
// インライン Server Action なので単体で import できない。代わりに「編集経路が
// 配信モジュールに依存していない」ことを構造として固定する — 将来うっかり
// 配線されたらこのテストが落ちる。
describe('編集経路（AC-15）', () => {
  it('events/[id]/edit は級別グループ配信を呼ばない', async () => {
    const { readFile } = await import('node:fs/promises')
    // vitest の cwd は apps/web。
    const source = await readFile(
      'src/app/(app)/events/[id]/edit/page.tsx',
      'utf8',
    )
    expect(source).not.toContain('event-grade-broadcast')
    expect(source).not.toContain('broadcastEventsToGradeGroups')
  })
})
