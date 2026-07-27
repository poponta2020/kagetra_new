import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { appSettings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin } from '@/test-utils/seed'
import { getEntryFormSettings, saveEntryFormSettings } from './settings'

// entry-form-autofill タスク6: 会の定数（申込書設定）の get/set が app_settings と
// 往復すること、未設定キーの扱い、updatedAt の明示更新を固定する。

describe('entry-form/settings', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未設定なら6項目とも null を返す', async () => {
    const settings = await getEntryFormSettings()
    expect(settings).toEqual({
      prefecture: null,
      clubName: null,
      managerName: null,
      phone: null,
      email: null,
      transferName: null,
    })
  })

  it('保存した値がそのまま読み出せる（往復）', async () => {
    const admin = await createAdmin()
    await saveEntryFormSettings(
      {
        prefecture: '北海道',
        clubName: '北海道大学かるた会',
        managerName: '土居 悠太',
        phone: '080-6846-0013',
        email: 'karuta_hokudai_0812@yahoo.co.jp',
        transferName: 'ﾎｯｶｲﾄﾞｳﾀﾞｲｶﾞｸｶﾙﾀｶｲ',
      },
      admin.id,
    )

    const settings = await getEntryFormSettings()
    expect(settings).toEqual({
      prefecture: '北海道',
      clubName: '北海道大学かるた会',
      managerName: '土居 悠太',
      phone: '080-6846-0013',
      email: 'karuta_hokudai_0812@yahoo.co.jp',
      transferName: 'ﾎｯｶｲﾄﾞｳﾀﾞｲｶﾞｸｶﾙﾀｶｲ',
    })
  })

  it('一部フィールドだけ渡すと、渡したキーだけ upsert される', async () => {
    const admin = await createAdmin()
    await saveEntryFormSettings({ prefecture: '北海道' }, admin.id)

    const settings = await getEntryFormSettings()
    expect(settings.prefecture).toBe('北海道')
    expect(settings.clubName).toBeNull()
  })

  it('空文字（trim 後も空）は未設定として扱われ、行が削除される', async () => {
    const admin = await createAdmin()
    await saveEntryFormSettings({ clubName: '北海道大学かるた会' }, admin.id)
    await saveEntryFormSettings({ clubName: '   ' }, admin.id)

    const settings = await getEntryFormSettings()
    expect(settings.clubName).toBeNull()

    const rows = await testDb.select().from(appSettings)
    expect(rows.find((row) => row.key === 'entry_form.club_name')).toBeUndefined()
  })

  it('再保存で上書きされ、updatedAt が更新される', async () => {
    const admin = await createAdmin()
    await saveEntryFormSettings({ managerName: '旧責任者' }, admin.id)
    const rowsBefore = await testDb.select().from(appSettings)
    const before = rowsBefore.find((row) => row.key === 'entry_form.manager_name')
    expect(before?.value).toBe('旧責任者')

    // 実DBラウンドトリップを挟むだけで JS Date() の解像度でも十分に差が出るが、
    // 念のため明示的に少し待って flaky を避ける。
    await new Promise((resolve) => setTimeout(resolve, 5))

    await saveEntryFormSettings({ managerName: '新責任者' }, admin.id)
    const rowsAfter = await testDb.select().from(appSettings)
    const after = rowsAfter.find((row) => row.key === 'entry_form.manager_name')

    expect(after?.value).toBe('新責任者')
    expect(before?.updatedAt).toBeDefined()
    expect(after?.updatedAt).toBeDefined()
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })
})
