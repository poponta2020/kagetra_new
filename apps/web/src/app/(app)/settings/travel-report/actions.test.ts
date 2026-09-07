import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appSettings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createGuest,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// travel-report タスク4: 遠征届設定（S4）Server Action の認可（AC-21）と保存。

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { saveTravelReportSettingsAction } = await import('./actions')

const VALID_VALUES = {
  advisorDepartment: '教育学院',
  advisorTitle: '教授',
  advisorName: '北海 太郎',
}

describe('settings/travel-report actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('admin が保存すると3項目とも app_settings に入る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await saveTravelReportSettingsAction(VALID_VALUES)

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(3)
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    expect(byKey['travel_report.advisor_department']).toBe('教育学院')
    expect(byKey['travel_report.advisor_title']).toBe('教授')
    expect(byKey['travel_report.advisor_name']).toBe('北海 太郎')
    expect(rows.every((row) => row.updatedBy === admin.id)).toBe(true)
  })

  it('vice_admin も保存できる', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await saveTravelReportSettingsAction(VALID_VALUES)

    const rows = await testDb.select().from(appSettings)
    expect(rows.every((row) => row.updatedBy === vice.id)).toBe(true)
  })

  it('副連絡責任者フラグを持つ一般会員も保存できる（AC-21）', async () => {
    const submitter = await createUser({ isTravelReportSubmitter: true })
    await setAuthSession({ id: submitter.id, role: 'member' })

    await saveTravelReportSettingsAction(VALID_VALUES)

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.updatedBy === submitter.id)).toBe(true)
  })

  it('未ログインは Unauthorized で拒否される', async () => {
    await setAuthSession(null)

    await expect(saveTravelReportSettingsAction(VALID_VALUES)).rejects.toThrow(
      'Unauthorized',
    )

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(0)
  })

  it('フラグの無い一般会員は Forbidden で拒否される（AC-21）', async () => {
    const member = await createUser({ isTravelReportSubmitter: false })
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(saveTravelReportSettingsAction(VALID_VALUES)).rejects.toThrow(
      'Forbidden',
    )

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(0)
  })

  it('ゲストはフラグがあっても Forbidden で拒否される（AC-21・AC-30）', async () => {
    const guest = await createGuest({ isTravelReportSubmitter: true })
    await setAuthSession({ id: guest.id, role: 'guest' })

    await expect(saveTravelReportSettingsAction(VALID_VALUES)).rejects.toThrow(
      'Forbidden',
    )

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(0)
  })
})
