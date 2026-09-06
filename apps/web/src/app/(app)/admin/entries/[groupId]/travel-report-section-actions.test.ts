import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { entryGroupTravelSettings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * travel-report タスク6: S5 遠征届セクションの Server Action（R4・R5・R7・AC-10/19/21）。
 * 確定状況（admin ∪ vice_admin のみ）と違い、**提出権限者**が実行できる。
 */

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const estimateDestination = vi.fn()
vi.mock('@/lib/travel-report/destination-ai', () => ({
  estimateDestination: (...args: unknown[]) => estimateDestination(...args),
}))

const { setTravelReportRequired, startTravelRouteInput, updateTravelDestination } = await import(
  './travel-report-actions'
)

// ★`afterAll` はトップレベルに1つだけ。
afterAll(async () => {
  await closeTestDb()
})

async function settingsOf(entryGroupId: number) {
  const [row] = await testDb
    .select()
    .from(entryGroupTravelSettings)
    .where(eq(entryGroupTravelSettings.entryGroupId, entryGroupId))
  return row ?? null
}

describe('必要/不要トグル（AC-10・AC-21）', () => {
  beforeEach(async () => {
    await truncateAll()
    estimateDestination.mockReset()
  })

  it('設定行が無くても既定は「必要」で、不要にすると行が作られる', async () => {
    const group = await createEntryGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    expect(await settingsOf(group.id)).toBeNull()
    await setTravelReportRequired(group.id, false)
    expect((await settingsOf(group.id))?.required).toBe(false)

    await setTravelReportRequired(group.id, true)
    expect((await settingsOf(group.id))?.required).toBe(true)
  })

  it('副管理者・副連絡責任者フラグ付きの一般会員も操作できる（AC-21）', async () => {
    const group = await createEntryGroup()
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })
    await setTravelReportRequired(group.id, false)
    expect((await settingsOf(group.id))?.required).toBe(false)

    const submitter = await createUser({ isTravelReportSubmitter: true })
    await setAuthSession({ id: submitter.id, role: 'member' })
    await setTravelReportRequired(group.id, true)
    expect((await settingsOf(group.id))?.required).toBe(true)
  })

  it('フラグの無い一般会員・ゲスト・未ログインは拒否される（AC-21）', async () => {
    const group = await createEntryGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(setTravelReportRequired(group.id, false)).rejects.toThrow('Forbidden')

    // ゲストにフラグが付いても権限にならない。
    const guest = await createGuest({ isTravelReportSubmitter: true })
    await setAuthSession({ id: guest.id, role: 'guest' })
    await expect(setTravelReportRequired(group.id, false)).rejects.toThrow('Forbidden')

    await setAuthSession(null)
    await expect(setTravelReportRequired(group.id, false)).rejects.toThrow('Unauthorized')
    expect(await settingsOf(group.id)).toBeNull()
  })

  it('退会済みの副連絡責任者は拒否される', async () => {
    const group = await createEntryGroup()
    const gone = await createUser({ isTravelReportSubmitter: true, deactivatedAt: new Date() })
    await setAuthSession({ id: gone.id, role: 'member' })
    await expect(setTravelReportRequired(group.id, false)).rejects.toThrow('Forbidden')
  })
})

describe('経路入力の開始と開催地の AI 推定（AC-11・AC-19）', () => {
  beforeEach(async () => {
    await truncateAll()
    estimateDestination.mockReset()
  })

  async function setupGroup() {
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2026-06-13',
      title: '青森大会',
      location: '青森県武道館',
    })
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    return group
  }

  it('開始時に開催地が未設定なら AI 推定が1回走り、AI推定として保存される', async () => {
    const group = await setupGroup()
    estimateDestination.mockResolvedValue({ prefecture: '青森県', city: '青森市', label: '青森' })

    await startTravelRouteInput(group.id)
    const row = await settingsOf(group.id)
    expect(row?.routeInputStartedAt).not.toBeNull()
    expect(row?.destinationLabel).toBe('青森')
    expect(row?.destinationPrefecture).toBe('青森県')
    expect(row?.destinationSource).toBe('ai')
    expect(row?.destinationAttemptedAt).not.toBeNull()
    expect(estimateDestination).toHaveBeenCalledTimes(1)
  })

  it('推定に失敗しても開始は成功し、開催地は空欄のまま（R7）', async () => {
    const group = await setupGroup()
    estimateDestination.mockResolvedValue(null)

    await startTravelRouteInput(group.id)
    const row = await settingsOf(group.id)
    expect(row?.routeInputStartedAt).not.toBeNull()
    expect(row?.destinationLabel).toBeNull()
    expect(row?.destinationSource).toBeNull()
    // ★試行済みは記録する（「未試行」と「失敗して空欄」を区別する）。
    expect(row?.destinationAttemptedAt).not.toBeNull()
  })

  it('2回目の開始では推定をやり直さない（attempted_at の claim が効く）', async () => {
    const group = await setupGroup()
    estimateDestination.mockResolvedValue(null)
    await startTravelRouteInput(group.id)
    await startTravelRouteInput(group.id)
    expect(estimateDestination).toHaveBeenCalledTimes(1)
  })

  it('手入力済み（manual）なら推定しない', async () => {
    const group = await setupGroup()
    await updateTravelDestination(group.id, { prefecture: null, city: null, label: '八戸' })
    await startTravelRouteInput(group.id)
    expect(estimateDestination).not.toHaveBeenCalled()
    expect((await settingsOf(group.id))?.destinationLabel).toBe('八戸')
  })

  it('提出権限者でなければ開始できない', async () => {
    const group = await setupGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(startTravelRouteInput(group.id)).rejects.toThrow('Forbidden')
  })
})

describe('開催地の手修正（AC-19・AC-21）', () => {
  beforeEach(async () => {
    await truncateAll()
    estimateDestination.mockReset()
  })

  it('手で直すと manual になり、以後 AI で上書きされない', async () => {
    const group = await createEntryGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await updateTravelDestination(group.id, {
      prefecture: '青森県',
      city: '八戸市',
      label: '八戸',
    })
    const row = await settingsOf(group.id)
    expect(row?.destinationLabel).toBe('八戸')
    expect(row?.destinationSource).toBe('manual')
    expect(row?.destinationAttemptedAt).not.toBeNull()
  })

  it('経路表記名が空なら拒否する', async () => {
    const group = await createEntryGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(
      updateTravelDestination(group.id, { prefecture: null, city: null, label: '  ' }),
    ).rejects.toThrow('経路表記名')
  })

  it('提出権限者でなければ修正できない', async () => {
    const group = await createEntryGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(
      updateTravelDestination(group.id, { prefecture: null, city: null, label: '八戸' }),
    ).rejects.toThrow('Forbidden')
  })
})
