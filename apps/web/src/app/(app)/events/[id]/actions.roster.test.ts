import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  tournamentEntryRosters,
  tournamentEntryRosterEntries,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// readExcel（Excel バイナリ読取）はモック。パース/材料化は本物を通す。
const { readExcelMock } = vi.hoisted(() => ({ readExcelMock: vi.fn() }))
vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@kagetra/mail-worker/result-import/reader', () => ({ readExcel: readExcelMock }))

const { uploadRoster } = await import('./actions')

function fileForm(rosterType: string): FormData {
  const fd = new FormData()
  fd.set('rosterType', rosterType)
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'roster.xlsx'))
  return fd
}

describe('uploadRoster', () => {
  // jsdom の File は arrayBuffer() 未実装。readExcel はモックなので中身は不問の polyfill。
  beforeAll(() => {
    if (typeof File !== 'undefined' && typeof File.prototype.arrayBuffer !== 'function') {
      Object.defineProperty(File.prototype, 'arrayBuffer', {
        value: async () => new ArrayBuffer(0),
        configurable: true,
        writable: true,
      })
    }
  })
  beforeEach(async () => {
    await truncateAll()
    readExcelMock.mockReset()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('admin が確定名簿を取り込むと roster+entries 作成・会員突合する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const member = await createUser({ name: '札幌太郎' })
    const event = await createEvent({ kind: 'individual' })
    readExcelMock.mockResolvedValue([
      {
        name: 'Sheet1',
        grid: [
          ['氏名', '級'],
          ['札幌太郎', 'A'],
          ['他県次郎', 'B'],
        ],
      },
    ])

    const r = await uploadRoster(event.id, fileForm('confirmed'))
    expect(r.entryCount).toBe(2)
    expect(r.matchedUserCount).toBe(1)

    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.eventId, event.id))
    expect(rosters).toHaveLength(1)
    expect(rosters[0]?.rosterType).toBe('confirmed')
    const entries = await testDb
      .select()
      .from(tournamentEntryRosterEntries)
      .where(eq(tournamentEntryRosterEntries.rosterId, rosters[0]!.id))
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.rawName === '札幌太郎')?.userId).toBe(member.id)
  })

  it('非 admin は拒否（Forbidden）', async () => {
    const u = await createUser()
    await setAuthSession({ id: u.id, role: 'member' })
    const event = await createEvent({ kind: 'individual' })
    await expect(uploadRoster(event.id, fileForm('confirmed'))).rejects.toThrow(/Forbidden/)
  })

  it('団体戦イベントは名簿取込を拒否', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const event = await createEvent({ kind: 'team' })
    readExcelMock.mockResolvedValue([{ name: 's', grid: [['氏名'], ['x']] }])
    await expect(uploadRoster(event.id, fileForm('confirmed'))).rejects.toThrow(/個人戦/)
  })

  it('氏名列の無いファイルはパース不能エラー・DB 不変', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const event = await createEvent({ kind: 'individual' })
    readExcelMock.mockResolvedValue([{ name: 's', grid: [['日付', '会場'], ['1/1', '近江']] }])
    await expect(uploadRoster(event.id, fileForm('confirmed'))).rejects.toThrow(/氏名列/)
    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(0)
  })

  it('roster_type 不正は弾く', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const event = await createEvent({ kind: 'individual' })
    await expect(uploadRoster(event.id, fileForm('bogus'))).rejects.toThrow(/名簿種別/)
  })
})
