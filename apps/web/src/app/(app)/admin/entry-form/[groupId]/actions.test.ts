import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFormDrafts, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { loadWorkbook } from '@/lib/entry-form/workbook'
import { estimateCellMap } from '@/lib/entry-form/cell-map'

// entry-form-autofill タスク7: プレビュー Server Actions。
// AC-2（認可）/ AC-4（テンプレ候補）/ AC-5（対象会員の和集合）/ AC-8（かな書き戻し）/
// AC-9（出場回数）/ AC-15（IMAP APPEND の引数）/ AC-17・AC-18（履歴と失敗時の扱い）。

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { appendDraftMock } = vi.hoisted(() => ({
  appendDraftMock: vi.fn(async (_mime: string) => undefined),
}))
vi.mock('@/lib/entry-form/imap-draft', () => ({ appendDraftToYahoo: appendDraftMock }))

// AI フォールバックは実 API を呼ばない。ヒューリスティックが高信頼を返す
// fixture しか使わないので、呼ばれないこと自体も検証対象になる。
const { inferCellMapMock } = vi.hoisted(() => ({
  inferCellMapMock: vi.fn(async () => null),
}))
vi.mock('@/lib/entry-form/ai-extract', () => ({
  inferCellMap: inferCellMapMock,
  sheetsToPromptText: () => '',
}))

const {
  analyzeTemplateAction,
  createEntryFormDraftAction,
  loadEntryFormContext,
  saveMemberNamesAction,
} = await import('./actions')

const FIXTURE_DIR = resolve(process.cwd(), 'src/lib/entry-form/__fixtures__')

async function fixtureBase64(name: string): Promise<string> {
  return (await readFile(resolve(FIXTURE_DIR, name))).toString('base64')
}

async function seedGroupWithAttendees() {
  const admin = await createAdmin()
  await setAuthSession({ id: admin.id, role: 'admin' })
  const group = await createEntryGroup()

  // 同一グループの2日程。両方に出席する会員がいても1行に重複排除される（AC-5）。
  const day1 = await createEvent({
    entryGroupId: group.id,
    title: '第3回青森大会（A級）',
    eventDate: '2030-05-10',
    entryDeadline: '2030-04-20',
    organizer: '青森かるた会',
  })
  const day2 = await createEvent({
    entryGroupId: group.id,
    title: '第3回青森大会（B級）',
    eventDate: '2030-05-11',
  })

  const both = await createUser({ name: '両日 太郎', grade: 'A', dan: 3 })
  const only2 = await createUser({ name: '二日目 花子', grade: 'B', dan: 1 })
  const absent = await createUser({ name: '欠席 次郎', grade: 'C' })

  await createEventAttendance({ eventId: day1.id, userId: both.id, attend: true })
  await createEventAttendance({ eventId: day2.id, userId: both.id, attend: true })
  await createEventAttendance({ eventId: day2.id, userId: only2.id, attend: true })
  await createEventAttendance({ eventId: day1.id, userId: absent.id, attend: false })

  return { admin, group, both, only2, absent }
}

describe('admin/entry-form actions', () => {
  beforeEach(async () => {
    await truncateAll()
    appendDraftMock.mockClear()
    appendDraftMock.mockResolvedValue(undefined)
    inferCellMapMock.mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('認可（AC-2）', () => {
    it('未ログインは Unauthorized', async () => {
      await setAuthSession(null)
      await expect(loadEntryFormContext(1)).rejects.toThrow('Unauthorized')
      await expect(saveMemberNamesAction([])).rejects.toThrow('Unauthorized')
      await expect(analyzeTemplateAction({})).rejects.toThrow('Unauthorized')
    })

    it('一般会員は Forbidden', async () => {
      const member = await createUser({ role: 'member' })
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(loadEntryFormContext(1)).rejects.toThrow('Forbidden')
      await expect(saveMemberNamesAction([])).rejects.toThrow('Forbidden')
    })
  })

  describe('loadEntryFormContext', () => {
    it('attend=true の和集合を会員単位で重複排除して返す（AC-5）', async () => {
      const { group, both, only2, absent } = await seedGroupWithAttendees()

      const context = await loadEntryFormContext(group.id)

      const userIds = context.members.map((m) => m.userId)
      expect(userIds).toHaveLength(2)
      expect(userIds).toContain(both.id)
      expect(userIds).toContain(only2.id)
      expect(userIds).not.toContain(absent.id)
    })

    it('グループのメタ情報（名称・開催日・締切・主催者）を返す', async () => {
      const { group } = await seedGroupWithAttendees()

      const context = await loadEntryFormContext(group.id)

      expect(context.eventDates).toEqual(['2030-05-10', '2030-05-11'])
      expect(context.entryDeadline).toBe('2030-04-20')
      expect(context.organizer).toBe('青森かるた会')
    })

    it('姓名・かなが未登録の会員に needsNameInput が立つ（AC-8 の警告条件）', async () => {
      const { group, both } = await seedGroupWithAttendees()

      const context = await loadEntryFormContext(group.id)

      expect(context.members.find((m) => m.userId === both.id)?.needsNameInput).toBe(true)
    })

    it('出場回数の基準日は当日（JST）で、結果に完全性フラグが載る（AC-9）', async () => {
      const { group } = await seedGroupWithAttendees()

      const context = await loadEntryFormContext(group.id)

      expect(context.appearanceReferenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(['complete', 'incomplete']).toContain(context.appearanceCompleteness)
    })

    it('存在しないグループはエラーになる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      await expect(loadEntryFormContext(99999)).rejects.toThrow('申込グループが見つかりません')
    })
  })

  describe('analyzeTemplateAction（AC-4 手動アップロード経路）', () => {
    it('ヒューリスティックが高信頼なら AI を呼ばず列対応と申込先を返す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const analysis = await analyzeTemplateAction({
        uploaded: { filename: 'standard.xlsx', base64: await fixtureBase64('standard.xlsx') },
      })

      expect(analysis.source).toBe('heuristic')
      expect(analysis.organizerEmail).toBe('entry@example.invalid')
      expect(analysis.cellMap.sheets[0]?.columns.familyName).toBe('F')
      expect(inferCellMapMock).not.toHaveBeenCalled()
    })

    it('低信頼テンプレでは AI へ回し、推定不可なら unresolved を返して手動へ誘導する（AC-7）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const analysis = await analyzeTemplateAction({
        uploaded: {
          filename: 'multisheet-ambiguous.xlsx',
          base64: await fixtureBase64('multisheet-ambiguous.xlsx'),
        },
      })

      expect(inferCellMapMock).toHaveBeenCalledTimes(1)
      expect(analysis.source).toBe('unresolved')
      expect(analysis.warnings.at(-1)).toContain('プレビューで指定してください')
    })

    it('xlsx として読めないファイルは中断してエラーになる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(
        analyzeTemplateAction({
          uploaded: { filename: 'broken.xlsx', base64: Buffer.from('not a zip').toString('base64') },
        }),
      ).rejects.toThrow('申込書ファイルを読み込めませんでした')
    })
  })

  describe('saveMemberNamesAction（AC-8）', () => {
    it('姓名・かなの4フィールドだけを users へ書き戻し、name は変更しない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const target = await createUser({ name: '山田 太郎' })

      await saveMemberNamesAction([
        {
          userId: target.id,
          familyName: '山田',
          givenName: '太郎',
          familyKana: 'やまだ',
          givenKana: 'たろう',
        },
      ])

      const [row] = await testDb.select().from(users).where(eq(users.id, target.id))
      expect(row?.familyName).toBe('山田')
      expect(row?.givenName).toBe('太郎')
      expect(row?.familyKana).toBe('やまだ')
      expect(row?.givenKana).toBe('たろう')
      expect(row?.name).toBe('山田 太郎')
    })

    it('全項目が空の行は既存値を消さずにスキップされる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const target = await createUser({ name: '既存 会員', familyName: '既存' })

      await saveMemberNamesAction([
        { userId: target.id, familyName: '  ', givenName: null, familyKana: null, givenKana: null },
      ])

      const [row] = await testDb.select().from(users).where(eq(users.id, target.id))
      expect(row?.familyName).toBe('既存')
    })
  })

  describe('createEntryFormDraftAction', () => {
    async function draftInput(groupId: number) {
      const base64 = await fixtureBase64('standard.xlsx')
      const cellMap = estimateCellMap(await loadWorkbook(Buffer.from(base64, 'base64')))
      return {
        groupId,
        uploaded: { filename: 'standard.xlsx', base64 },
        cellMap: { sheets: cellMap.sheets },
        members: [
          {
            grade: 'A' as const,
            dan: 3,
            familyName: '土居',
            givenName: '悠太',
            familyKana: 'どい',
            givenKana: 'ゆうた',
            appearanceCount: 2,
            note: null,
          },
        ],
        toEmail: 'entry@example.invalid',
        subject: '青森大会申込み（北海道大学かるた会）',
        body: '本文',
        attachmentFilename: '【北海道大学かるた会】standard.xlsx',
      }
    }

    it('履歴を保存し、Draft フォルダへ APPEND する（AC-15, AC-17）', async () => {
      const { group } = await seedGroupWithAttendees()

      const result = await createEntryFormDraftAction(await draftInput(group.id))

      expect(result.status).toBe('created')
      expect(appendDraftMock).toHaveBeenCalledTimes(1)
      const mime = appendDraftMock.mock.calls[0]![0]
      expect(mime).toContain('To: entry@example.invalid')
      expect(mime).toContain('Content-Type: multipart/mixed')

      const [row] = await testDb
        .select()
        .from(entryFormDrafts)
        .where(eq(entryFormDrafts.id, result.draftId))
      expect(row?.status).toBe('created')
      expect(row?.memberCount).toBe(1)
      expect(row?.attachmentFilename).toBe('【北海道大学かるた会】standard.xlsx')
      expect(row?.xlsx.length).toBeGreaterThan(0)
    })

    it('保存された xlsx に会員が記入されている（AC-10 の経路確認）', async () => {
      const { group } = await seedGroupWithAttendees()

      const result = await createEntryFormDraftAction(await draftInput(group.id))

      const [row] = await testDb
        .select()
        .from(entryFormDrafts)
        .where(eq(entryFormDrafts.id, result.draftId))
      const workbook = await loadWorkbook(row!.xlsx)
      expect(workbook.worksheets[0]!.getCell('F12').value).toBe('土居')
      expect(workbook.worksheets[0]!.getCell('E12').value).toBe('3段')
    })

    it('IMAP 失敗でも履歴は残り、status=imap_failed とエラーが記録される（AC-18）', async () => {
      const { group } = await seedGroupWithAttendees()
      appendDraftMock.mockRejectedValueOnce(
        new Error('Yahoo メールへの下書き作成に失敗しました: connection refused'),
      )

      const result = await createEntryFormDraftAction(await draftInput(group.id))

      expect(result.status).toBe('imap_failed')
      expect(result.imapError).toContain('下書き作成に失敗しました')

      const [row] = await testDb
        .select()
        .from(entryFormDrafts)
        .where(eq(entryFormDrafts.id, result.draftId))
      expect(row?.status).toBe('imap_failed')
      expect(row?.imapError).toContain('connection refused')
      // 生成済み xlsx は失われない（その場でダウンロードできる）。
      expect(row?.xlsx.length).toBeGreaterThan(0)
    })

    it('作成後は latestDraft として進行管理から引き当てられる（AC-17）', async () => {
      const { group, admin } = await seedGroupWithAttendees()

      await createEntryFormDraftAction(await draftInput(group.id))
      const context = await loadEntryFormContext(group.id)

      expect(context.latestDraft?.memberCount).toBe(1)
      expect(context.latestDraft?.createdByName).toBe(admin.name)
      expect(context.latestDraft?.status).toBe('created')
    })
  })
})
