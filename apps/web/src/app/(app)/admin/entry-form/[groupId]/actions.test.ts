import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFormDrafts, events, users } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createMailMessage,
  createTournamentDraft,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { loadWorkbook } from '@/lib/entry-form/workbook'
import { saveEntryFormSettings } from '@/lib/entry-form/settings'
import { estimateCellMap } from '@/lib/entry-form/cell-map'

// entry-form-autofill タスク7: プレビュー Server Actions。
// AC-2（認可）/ AC-4（テンプレ候補）/ AC-5（対象会員の和集合）/ AC-8（かな書き戻し）/
// AC-9（出場回数）/ AC-15（IMAP APPEND の引数）/ AC-17・AC-18（履歴と失敗時の扱い）。

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { appendDraftMock } = vi.hoisted(() => ({
  appendDraftMock: vi.fn(
    async (_mime: string, _options?: { messageId?: string; requireIdempotencyCheck?: boolean }) => ({
      appended: true,
    }),
  ),
}))
vi.mock('@/lib/entry-form/imap-draft', () => ({ appendDraftToYahoo: appendDraftMock }))

// AI フォールバックは実 API を呼ばない。ヒューリスティックが高信頼を返す
// fixture しか使わないので、呼ばれないこと自体も検証対象になる。
const { inferCellMapMock, extractOrganizerInstructionsMock } = vi.hoisted(() => ({
  inferCellMapMock: vi.fn(async () => null),
  // 引数の型を明示する（引数なしの vi.fn だと mock.calls の要素が空タプル型になり
  // 呼出引数を assert できない）。
  extractOrganizerInstructionsMock: vi.fn(
    async (_mailBodyText: string, _sheetsText?: string) =>
      null as
        | { subject: string | null; attachmentFilename: string | null; toEmail: string | null }
        | null,
  ),
}))
vi.mock('@/lib/entry-form/ai-extract', () => ({
  inferCellMap: inferCellMapMock,
  extractOrganizerInstructions: extractOrganizerInstructionsMock,
  sheetsToPromptText: () => '',
}))

const {
  analyzeTemplateAction,
  createEntryFormDraftAction,
  listAddableMembersAction,
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

  return { admin, group, both, only2, absent, day1 }
}

/** 案内メール（tournament_draft 経由）が紐付いたグループ。テンプレ候補と AI 抽出の入力になる。 */
async function seedGroupWithAttendeesAndMail() {
  const seeded = await seedGroupWithAttendees()
  const mail = await createMailMessage({
    bodyText: '件名は「（所属会名）第3回青森大会申込み」としてください。',
  })
  const draft = await createTournamentDraft({ messageId: mail.id })
  await testDb.update(events).set({ tournamentDraftId: draft.id }).where(eq(events.id, seeded.day1.id))
  return { ...seeded, mail, draft }
}

describe('admin/entry-form actions', () => {
  beforeEach(async () => {
    await truncateAll()
    appendDraftMock.mockClear()
    appendDraftMock.mockResolvedValue({ appended: true })
    inferCellMapMock.mockClear()
    extractOrganizerInstructionsMock.mockClear()
    extractOrganizerInstructionsMock.mockResolvedValue(null)
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

    // guest-role タスク6 E1 (AC-17): ゲストは会経由で申し込まないので、
    // attend=true でも申込書の対象会員一覧に現れない。
    it('guest-role AC-17: attend=true のゲストは対象会員一覧に現れない', async () => {
      const { group, day1, both, only2 } = await seedGroupWithAttendees()
      const guest = await createGuest({ name: 'ゲスト 参加希望' })
      await createEventAttendance({ eventId: day1.id, userId: guest.id, attend: true })

      const context = await loadEntryFormContext(group.id)

      const userIds = context.members.map((m) => m.userId)
      expect(userIds).toContain(both.id)
      expect(userIds).toContain(only2.id)
      expect(userIds).not.toContain(guest.id)
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

    it('案内メール本文が無くても xlsx 内の主催者指定は抽出しにいく', async () => {
      // requirements §3.2.6 は「案内メール本文・xlsx 内にあれば」なので、
      // 手動アップロードや本文が空のメールでも xlsx 側の指定を拾う必要がある。
      const { group } = await seedGroupWithAttendees()

      await analyzeTemplateAction({
        groupId: group.id,
        uploaded: { filename: 'standard.xlsx', base64: await fixtureBase64('standard.xlsx') },
      })

      expect(extractOrganizerInstructionsMock).toHaveBeenCalledTimes(1)
      // 本文は空文字で渡り、シートのテキスト表現が抽出対象になる。
      expect(extractOrganizerInstructionsMock.mock.calls[0]![0]).toBe('')
    })

    it('案内メール本文があれば主催者指定（件名・ファイル名・申込先）を抽出して返す（AC-13）', async () => {
      const { group } = await seedGroupWithAttendeesAndMail()
      extractOrganizerInstructionsMock.mockResolvedValue({
        subject: '（所属会名）第3回青森大会申込み',
        attachmentFilename: '青森大会_申込書_北大.xlsx',
        toEmail: 'organizer@example.invalid',
      })

      const analysis = await analyzeTemplateAction({
        groupId: group.id,
        uploaded: { filename: 'standard.xlsx', base64: await fixtureBase64('standard.xlsx') },
      })

      expect(extractOrganizerInstructionsMock).toHaveBeenCalledTimes(1)
      expect(extractOrganizerInstructionsMock.mock.calls[0]![0]).toContain('件名は')
      expect(analysis.organizerInstructions).toEqual({
        subject: '（所属会名）第3回青森大会申込み',
        attachmentFilename: '青森大会_申込書_北大.xlsx',
        toEmail: 'organizer@example.invalid',
      })
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
    /** 差出人（settings.email）が無いと作成は拒否されるので、各テストの前に入れる。 */
    async function seedClubSettings() {
      await saveEntryFormSettings(
        { clubName: '北海道大学かるた会', email: 'club@example.invalid', managerName: '土居 悠太' },
        null,
      )
    }

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
      await seedClubSettings()

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
      await seedClubSettings()

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
      await seedClubSettings()
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
      await seedClubSettings()

      await createEntryFormDraftAction(await draftInput(group.id))
      const context = await loadEntryFormContext(group.id)

      expect(context.latestDraft?.memberCount).toBe(1)
      expect(context.latestDraft?.createdByName).toBe(admin.name)
      expect(context.latestDraft?.status).toBe('created')
    })

    it('複数シートで対象級が未確定なら Server Action 側でも拒否する（全件重複記入の防止）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = input.cellMap.sheets[0]!

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [sheet, { ...sheet, sheetName: '2枚目' }] },
        }),
      ).rejects.toThrow('対象の級が決まっていないシート')
    })

    it('同じ級が複数シートに割り当てられていたら拒否する（二重記入の防止）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = { ...input.cellMap.sheets[0]!, targetGrades: ['A' as const] }

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [sheet, { ...sheet, sheetName: '2枚目' }] },
        }),
      ).rejects.toThrow('複数のシートに割り当てられています')
    })

    it('宛先の形式が不正なら履歴を作る前に拒否する（imap_failed として記録しない）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)

      await expect(
        createEntryFormDraftAction({ ...input, toEmail: 'organizer' }),
      ).rejects.toThrow('形式が正しくありません')

      const rows = await testDb.select().from(entryFormDrafts)
      expect(rows).toHaveLength(0)
      expect(appendDraftMock).not.toHaveBeenCalled()
    })

    it('失敗のやり直しは同じ履歴行と Message-ID を使う（下書きの重複防止）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      appendDraftMock.mockRejectedValueOnce(new Error('connection reset'))

      const first = await createEntryFormDraftAction(input)
      expect(first.status).toBe('imap_failed')
      const [failed] = await testDb.select().from(entryFormDrafts)

      const retried = await createEntryFormDraftAction({ ...input, retryDraftId: first.draftId })

      expect(retried.draftId).toBe(first.draftId)
      const rows = await testDb.select().from(entryFormDrafts)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.messageId).toBe(failed!.messageId)
      expect(rows[0]!.status).toBe('created')
      // 冪等キーとして同じ Message-ID を APPEND へ渡している。
      expect(appendDraftMock.mock.calls.at(-1)![1]).toEqual({
        messageId: failed!.messageId,
        requireIdempotencyCheck: true,
      })
    })

    it('同じ下書きへの同時再試行は1つだけが IMAP へ進む（下書きの重複防止）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      appendDraftMock.mockRejectedValueOnce(new Error('connection reset'))
      const first = await createEntryFormDraftAction(input)
      appendDraftMock.mockClear()

      // claim は条件付き UPDATE なので、2つ目は行を取れずに弾かれる。
      const retry = { ...input, retryDraftId: first.draftId }
      const results = await Promise.allSettled([
        createEntryFormDraftAction(retry),
        createEntryFormDraftAction(retry),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled).toHaveLength(1)
      expect(appendDraftMock).toHaveBeenCalledTimes(1)
      const rows = await testDb.select().from(entryFormDrafts)
      expect(rows).toHaveLength(1)
    })

    it('既に作成済みの下書きは再試行できない', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const created = await createEntryFormDraftAction(input)

      await expect(
        createEntryFormDraftAction({ ...input, retryDraftId: created.draftId }),
      ).rejects.toThrow('既に作成済み')
    })

    it('列に「F12」のようなセルアドレスを送ると拒否する（F1212 への誤記入を防ぐ）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = input.cellMap.sheets[0]!

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [{ ...sheet, columns: { ...sheet.columns, familyName: 'F12' } }] },
        }),
      ).rejects.toThrow('列以外が指定されています')
    })

    it('同じ列に2項目を割り当てると拒否する（後勝ちの上書きを防ぐ）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = input.cellMap.sheets[0]!

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [{ ...sheet, columns: { ...sheet.columns, grade: 'F' } }] },
        }),
      ).rejects.toThrow('複数の項目')
    })

    it('申込書に無いシート名を送ると拒否する', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = input.cellMap.sheets[0]!

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [{ ...sheet, sheetName: '存在しないシート' }] },
        }),
      ).rejects.toThrow('が申込書にありません')
    })

    it('氏名の列が無い CellMap を直接送ると拒否する（空欄の申込書を作らない）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)
      const sheet = input.cellMap.sheets[0]!

      await expect(
        createEntryFormDraftAction({
          ...input,
          cellMap: { sheets: [{ ...sheet, columns: {} }] },
        }),
      ).rejects.toThrow('氏名の列が指定されていません')
    })

    it('会員0名では拒否する（Server Action を直接呼んでも空の申込書は作れない）', async () => {
      const { group } = await seedGroupWithAttendees()
      await seedClubSettings()
      const input = await draftInput(group.id)

      await expect(
        createEntryFormDraftAction({ ...input, members: [] }),
      ).rejects.toThrow('記入する会員が0名です')

      const rows = await testDb.select().from(entryFormDrafts)
      expect(rows).toHaveLength(0)
    })

    it('差出人（連絡先 E-Mail）が未設定なら作成前に拒否する', async () => {
      const { group } = await seedGroupWithAttendees()

      await expect(createEntryFormDraftAction(await draftInput(group.id))).rejects.toThrow(
        '連絡先 E-Mail が未設定',
      )
    })
  })

  describe('listAddableMembersAction（AC-5: 会員一覧からの行追加）', () => {
    it('既に対象になっている会員を除いた候補を返す', async () => {
      const { both, only2, absent } = await seedGroupWithAttendees()

      const candidates = await listAddableMembersAction([both.id, only2.id])

      const ids = candidates.members.map((c) => c.userId)
      expect(ids).not.toContain(both.id)
      expect(ids).not.toContain(only2.id)
      // 出欠が「不参加」の会員も手で足せる（要件 §3.2.1 の行の追加）。
      expect(ids).toContain(absent.id)
    })

    it('候補にも出場回数と姓名かなの未登録フラグが載る', async () => {
      const { absent } = await seedGroupWithAttendees()

      const candidates = await listAddableMembersAction([])

      const target = candidates.members.find((c) => c.userId === absent.id)
      expect(target?.grade).toBe('C')
      expect(target?.needsNameInput).toBe(true)
      expect(target).toHaveProperty('appearanceCount')
    })

    it('一般会員は Forbidden', async () => {
      const member = await createUser({ role: 'member' })
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(listAddableMembersAction([])).rejects.toThrow('Forbidden')
    })
  })
})
