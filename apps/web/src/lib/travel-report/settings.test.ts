import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { appSettings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin } from '@/test-utils/seed'
import { getTravelReportSettings, saveTravelReportSettings } from './settings'

// travel-report タスク4: 遠征届設定（顧問教員3項目）の get/set が app_settings
// と往復すること、初期値が空であること（原本の値をコードに埋め込まない）を固定する。

describe('travel-report/settings', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未設定なら3項目とも null を返す（初期値は空。requirements R11）', async () => {
    const settings = await getTravelReportSettings()
    expect(settings).toEqual({
      advisorDepartment: null,
      advisorTitle: null,
      advisorName: null,
    })
  })

  it('保存した値がそのまま読み出せる（往復）', async () => {
    const admin = await createAdmin()
    await saveTravelReportSettings(
      {
        advisorDepartment: '教育学院',
        advisorTitle: '教授',
        advisorName: '北海 太郎',
      },
      admin.id,
    )

    const settings = await getTravelReportSettings()
    expect(settings).toEqual({
      advisorDepartment: '教育学院',
      advisorTitle: '教授',
      advisorName: '北海 太郎',
    })
  })

  it('一部フィールドだけ渡すと、渡したキーだけ upsert される', async () => {
    const admin = await createAdmin()
    await saveTravelReportSettings({ advisorName: '北海 太郎' }, admin.id)

    const settings = await getTravelReportSettings()
    expect(settings.advisorName).toBe('北海 太郎')
    expect(settings.advisorDepartment).toBeNull()
  })

  it('空文字（trim 後も空）は未設定として扱われ、行が削除される', async () => {
    const admin = await createAdmin()
    await saveTravelReportSettings({ advisorName: '北海 太郎' }, admin.id)
    await saveTravelReportSettings({ advisorName: '   ' }, admin.id)

    const settings = await getTravelReportSettings()
    expect(settings.advisorName).toBeNull()

    const rows = await testDb.select().from(appSettings)
    expect(
      rows.find((row) => row.key === 'travel_report.advisor_name'),
    ).toBeUndefined()
  })

  it('再保存で上書きされ、updatedAt が更新される', async () => {
    const admin = await createAdmin()
    await saveTravelReportSettings({ advisorTitle: '准教授' }, admin.id)
    const rowsBefore = await testDb.select().from(appSettings)
    const before = rowsBefore.find((row) => row.key === 'travel_report.advisor_title')
    expect(before?.value).toBe('准教授')

    await new Promise((resolve) => setTimeout(resolve, 5))

    await saveTravelReportSettings({ advisorTitle: '教授' }, admin.id)
    const rowsAfter = await testDb.select().from(appSettings)
    const after = rowsAfter.find((row) => row.key === 'travel_report.advisor_title')

    expect(after?.value).toBe('教授')
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })
})
