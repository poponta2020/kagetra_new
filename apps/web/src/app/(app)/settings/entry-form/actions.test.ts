import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appSettings } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// entry-form-autofill タスク6: 申込書設定 Server Action の認可（AC-2）と保存（AC-1）。

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { saveEntryFormSettingsAction } = await import('./actions')

const VALID_VALUES = {
  prefecture: '北海道',
  clubName: '北海道大学かるた会',
  managerName: '土居 悠太',
  phone: '080-6846-0013',
  email: 'karuta_hokudai_0812@yahoo.co.jp',
  transferName: 'ﾎｯｶｲﾄﾞｳﾀﾞｲｶﾞｸｶﾙﾀｶｲ',
}

describe('settings/entry-form actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('admin が保存すると6項目とも app_settings に入る（AC-1）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await saveEntryFormSettingsAction(VALID_VALUES)

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(6)
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    expect(byKey['entry_form.prefecture']).toBe('北海道')
    expect(byKey['entry_form.club_name']).toBe('北海道大学かるた会')
    expect(byKey['entry_form.manager_name']).toBe('土居 悠太')
    expect(byKey['entry_form.phone']).toBe('080-6846-0013')
    expect(byKey['entry_form.email']).toBe('karuta_hokudai_0812@yahoo.co.jp')
    expect(byKey['entry_form.transfer_name']).toBe('ﾎｯｶｲﾄﾞｳﾀﾞｲｶﾞｸｶﾙﾀｶｲ')
    expect(rows.every((row) => row.updatedBy === admin.id)).toBe(true)
  })

  it('vice_admin も保存できる', async () => {
    const vice = await createViceAdmin()
    await setAuthSession({ id: vice.id, role: 'vice_admin' })

    await saveEntryFormSettingsAction(VALID_VALUES)

    const rows = await testDb.select().from(appSettings)
    expect(rows.every((row) => row.updatedBy === vice.id)).toBe(true)
  })

  it('未ログインは Unauthorized で拒否される', async () => {
    await setAuthSession(null)

    await expect(saveEntryFormSettingsAction(VALID_VALUES)).rejects.toThrow('Unauthorized')

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(0)
  })

  it('一般会員（role=member）は Forbidden で拒否される（AC-2）', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })

    await expect(saveEntryFormSettingsAction(VALID_VALUES)).rejects.toThrow('Forbidden')

    const rows = await testDb.select().from(appSettings)
    expect(rows).toHaveLength(0)
  })

  it('E-Mail の形式が不正だと拒否される（空文字は許容）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    await expect(
      saveEntryFormSettingsAction({ ...VALID_VALUES, email: 'not-an-email' }),
    ).rejects.toThrow('E-Mail')

    await expect(
      saveEntryFormSettingsAction({ ...VALID_VALUES, email: '' }),
    ).resolves.toBeUndefined()
  })
})
