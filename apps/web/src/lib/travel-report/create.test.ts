import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  appSettings,
  entryGroupTravelSettings,
  travelReportBatches,
  travelReportDocuments,
  travelRoutes,
} from '@kagetra/shared/schema'
import { TRAVEL_REPORT_SETTING_KEYS } from '@kagetra/shared'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { createTravelReports, loadTravelReportDefaults } from './create'
import { readTravelReportDocx } from './docx/read'

/**
 * travel-report R9・R10・AC-20〜AC-27: 遠征届の作成。
 * 生成した docx を読み戻して、届の各欄・名簿・備考が仕様どおりかを見る。
 */

afterAll(async () => {
  await closeTestDb()
})

const UNIT1 = ['2026-11-07', '2026-11-08']
const UNIT2 = ['2026-11-14', '2026-11-15']

async function seedGroup() {
  const group = await createEntryGroup()
  const eventIds: Record<string, number> = {}
  for (const [i, date] of [...UNIT1, ...UNIT2].entries()) {
    const ev = await createEvent({
      entryGroupId: group.id,
      eventDate: date,
      title: '帯広新人戦',
      formalName: '第20回 帯広かるた新人戦',
      location: '帯広市総合体育館',
      eligibleGrades: i < 2 ? ['A', 'B'] : ['D'],
    })
    eventIds[date] = ev.id
  }
  await testDb.insert(entryGroupTravelSettings).values({
    entryGroupId: group.id,
    destinationLabel: '帯広',
    destinationPrefecture: '北海道',
    destinationCity: '帯広市',
    destinationSource: 'manual',
  })
  return { group, eventIds }
}

async function seedMember(
  eventIds: Record<string, number>,
  dates: readonly string[],
  overrides: Parameters<typeof createUser>[0] = {},
) {
  const user = await createUser({ isCircleMember: true, ...overrides })
  for (const date of dates) {
    await createEventAttendance({ eventId: eventIds[date]!, userId: user.id, attend: true })
  }
  return user
}

async function saveRoute(
  entryGroupId: number,
  unitStartDate: string,
  userId: string,
  legs: { date: string; from: string; to: string }[],
) {
  await testDb.insert(travelRoutes).values({
    entryGroupId,
    unitStartDate,
    userId,
    departureKind: 'sapporo',
    returnKind: 'sapporo',
    legs,
    savedByUserId: userId,
  })
}

describe('S6 の既定値（R9・AC-20）', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it('ファイル分割の既定は遠征単位（連続開催日）', async () => {
    const { group, eventIds } = await seedGroup()
    await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎', familyKana: 'ほっかい', schoolYear: '4年', faculty: '法学部', phone: '090-0000-0001' })
    const { files } = await loadTravelReportDefaults(group.id)
    expect(files).toHaveLength(2)
    expect(files[0]!.dates).toEqual(UNIT1)
    expect(files[1]!.dates).toEqual(UNIT2)
  })

  it('目的は「{正式名称}({級})への参加」、場所は会場（重複を除いて連結）', async () => {
    const { group, eventIds } = await seedGroup()
    await seedMember(eventIds, UNIT1)
    const { files } = await loadTravelReportDefaults(group.id)
    expect(files[0]!.purpose).toBe('第20回 帯広かるた新人戦(AB級)への参加')
    expect(files[0]!.place).toBe('帯広市総合体育館')
  })

  it('遠征先連絡者は役職順（サークル長が最優先）、留守連絡先はサークル長が出るなら副連絡責任者', async () => {
    const { group, eventIds } = await seedGroup()
    // サークル長が出場する → 留守連絡先は出場しない副連絡責任者へ。
    await seedMember(eventIds, UNIT1, {
      familyName: '北海',
      givenName: '太郎',
      isCircleLeader: true,
      phone: '090-0000-0001',
    })
    await createUser({
      isCircleMember: true,
      familyName: '旭川',
      givenName: 'さくら',
      isTravelReportSubmitter: true,
      phone: '090-0000-0002',
    })
    const { files } = await loadTravelReportDefaults(group.id)
    expect(files[0]!.destinationContacts[0]).toEqual({ name: '北海太郎', phone: '090-0000-0001' })
    expect(files[0]!.homeContact).toEqual({ name: '旭川さくら', phone: '090-0000-0002' })
  })

  it('未入力者を警告として返す（作成は止めない）', async () => {
    const { group, eventIds } = await seedGroup()
    const a = await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎' })
    await seedMember(eventIds, UNIT1, { familyName: '小樽', givenName: '花' })
    await saveRoute(group.id, UNIT1[0]!, a.id, [{ date: '2026-11-06', from: '札幌', to: '帯広' }])
    const { files } = await loadTravelReportDefaults(group.id)
    expect(files[0]!.memberCount).toBe(2)
    expect(files[0]!.pendingNames).toEqual(['小樽花'])
  })

  it('退会済み会員は対象者・名簿・連絡者候補のいずれにも入らない（Codex R1 #2）', async () => {
    const { group, eventIds } = await seedGroup()
    await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎' })
    // サークル長・提出権限者フラグ持ちだが退会済み。
    await seedMember(eventIds, UNIT1, {
      familyName: '小樽',
      givenName: '花',
      isCircleLeader: true,
      isTravelReportSubmitter: true,
      deactivatedAt: new Date(),
    })
    const { files } = await loadTravelReportDefaults(group.id)
    // 名簿・出場者数に退会済みは含まれない。
    expect(files[0]!.memberCount).toBe(1)
    expect(files[0]!.pendingNames).toEqual(['北海太郎'])
    // 退会済みのサークル長は団体代表者候補から外れる（欄が空になる）ことを
    // createTravelReports の出力で確認する。
    const creator = await createUser({ role: 'admin' })
    const result = await createTravelReports(group.id, [files[0]!], creator.id)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    const view = await readTravelReportDocx(doc!.docx)
    expect(view.signatureParagraphs.join('\n')).not.toContain('小樽花')
  })
})

describe('遠征届の生成と保存（AC-22〜27）', () => {
  beforeEach(async () => {
    await truncateAll()
    await testDb.insert(appSettings).values([
      { key: TRAVEL_REPORT_SETTING_KEYS.advisorDepartment, value: '北海道大学大学院工学研究院' },
      { key: TRAVEL_REPORT_SETTING_KEYS.advisorTitle, value: '教授' },
      { key: TRAVEL_REPORT_SETTING_KEYS.advisorName, value: '山田花子' },
    ])
  })

  it('分割どおりのファイル数で保存され、履歴からダウンロードできる形になる（AC-20・AC-27）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎' })
    await seedMember(eventIds, UNIT2, { familyName: '小樽', givenName: '花' })

    const { files } = await loadTravelReportDefaults(group.id)
    const result = await createTravelReports(group.id, files, creator.id)

    expect(result.documents).toHaveLength(2)
    const batches = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batches).toHaveLength(1)
    const docs = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.batchId, result.batchId))
    expect(docs).toHaveLength(2)
    expect(docs[0]!.filename).toBe('2026.11.7,8 帯広新人戦 遠征届.docx')
    expect(docs[1]!.filename).toBe('2026.11.14,15 帯広新人戦 遠征届.docx')
    // 含まれる日の events.id が記録される。
    expect(docs[0]!.eventIds).toEqual([eventIds[UNIT1[0]!], eventIds[UNIT1[1]!]])
  })

  it('生成 docx に 目的・場所・人数・名簿・備考・団体代表者・顧問教員 が入る（AC-22・AC-26）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    const leader = await seedMember(eventIds, UNIT1, {
      familyName: '北海',
      givenName: '太郎',
      familyKana: 'ほっかい',
      givenKana: 'たろう',
      faculty: '法学部',
      schoolYear: '4年',
      phone: '090-0000-0001',
      isCircleLeader: true,
    })
    const junior = await seedMember(eventIds, UNIT1, {
      familyName: '小樽',
      givenName: '花',
      familyKana: 'おたる',
      givenKana: 'はな',
      faculty: '工学部',
      schoolYear: '2年',
      phone: '090-0000-0002',
    })
    for (const id of [leader.id, junior.id]) {
      await saveRoute(group.id, UNIT1[0]!, id, [
        { date: '2026-11-06', from: '札幌', to: '帯広' },
        { date: '2026-11-09', from: '帯広', to: '札幌' },
      ])
    }

    const { files } = await loadTravelReportDefaults(group.id)
    const result = await createTravelReports(group.id, [files[0]!], creator.id)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    const view = await readTravelReportDocx(doc!.docx)

    expect(view.headerCells[3]![1]).toBe('第20回 帯広かるた新人戦(AB級)への参加')
    expect(view.headerCells[4]![1]).toBe('帯広市総合体育館')
    expect(view.headerCells[9]![1]).toContain('2人')
    // 期間は移動行＋出場日から（11/6〜11/9 の4日間）。
    expect(view.headerCells[8]![1]).toContain('11月')
    expect(view.headerCells[8]![1]).toContain('（　　　　　4日間）')
    // 名簿は学年の高い順。
    expect(view.rosterRows[0]!.slice(1, 5)).toEqual(['北海太郎', '法学部', '4年', '090-0000-0001'])
    expect(view.rosterRows[1]!.slice(1, 5)).toEqual(['小樽花', '工学部', '2年', '090-0000-0002'])
    // 備考は日付順・同一内容をまとめる。
    const remarks = view.headerCells[10]![1]!.split('\n')
    expect(remarks[0]).toBe('11/6 [北海、小樽]札幌→帯広')
    expect(remarks[1]).toBe('11/7 [北海、小樽]大会出場')
    // 団体代表者はサークル長、顧問教員は設定から。
    const signature = view.signatureParagraphs.join('\n')
    expect(signature).toContain('法学部 4年')
    expect(signature).toContain('北海太郎')
    expect(signature).toContain('北海道大学大学院工学研究院')
    expect(signature).toContain('山田花子')
  })

  it('未入力者も名簿に載り、備考には出場行だけが出る（R9）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    const entered = await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎', familyKana: 'ほっかい' })
    await seedMember(eventIds, UNIT1, { familyName: '小樽', givenName: '花', familyKana: 'おたる' })
    await saveRoute(group.id, UNIT1[0]!, entered.id, [
      { date: '2026-11-06', from: '札幌', to: '帯広' },
    ])

    const { files } = await loadTravelReportDefaults(group.id)
    const result = await createTravelReports(group.id, [files[0]!], creator.id)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    const view = await readTravelReportDocx(doc!.docx)

    expect(view.headerCells[9]![1]).toContain('2人')
    // 学年が両方とも未設定なので、並びはかな順（おたる → ほっかい）になる。
    expect(view.rosterRows.filter((r) => r[1] !== '').map((r) => r[1])).toEqual(['小樽花', '北海太郎'])
    const remarks = view.headerCells[10]![1]!
    expect(remarks).toContain('[北海]札幌→帯広')
    // 未入力の人は移動行を持たないので出場行にだけ現れる（姓は名簿順）。
    expect(remarks).toContain('[小樽、北海]大会出場')
  })

  it('サークル長・顧問教員が未設定でも作成は成功し、欄が空になる（R13）', async () => {
    await testDb.delete(appSettings)
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎' })

    const { files } = await loadTravelReportDefaults(group.id)
    const result = await createTravelReports(group.id, [files[0]!], creator.id)
    expect(result.documents).toHaveLength(1)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    const view = await readTravelReportDocx(doc!.docx)
    // 固定文言は残るが、代表者・顧問の値は空。
    expect(view.signatureParagraphs.join('\n')).toContain('北海道大学かるた会')
    expect(view.signatureParagraphs.join('\n')).not.toContain('法学部')
  })

  it('作り直しても過去の版は残る（追記専用の履歴）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    await seedMember(eventIds, UNIT1, { familyName: '北海', givenName: '太郎' })
    const { files } = await loadTravelReportDefaults(group.id)
    await createTravelReports(group.id, [files[0]!], creator.id)
    await createTravelReports(group.id, [files[0]!], creator.id)
    const batches = await testDb
      .select()
      .from(travelReportBatches)
      .where(eq(travelReportBatches.entryGroupId, group.id))
    expect(batches).toHaveLength(2)
  })

  it('S6 で統合した分割どおりのファイル数になる（AC-20）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    await seedMember(eventIds, [...UNIT1, ...UNIT2], { familyName: '北海', givenName: '太郎' })
    const { files } = await loadTravelReportDefaults(group.id)
    // 2単位を1ファイルへ統合して渡す。
    const merged = { ...files[0]!, dates: [...UNIT1, ...UNIT2] }
    const result = await createTravelReports(group.id, [merged], creator.id)
    expect(result.documents).toHaveLength(1)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    expect(doc!.eventIds).toHaveLength(4)
  })

  it('複数単位を1ファイルへ統合すると、同じ会員の両単位の移動行が備考と期間の両方に出る（Codex R1 #6）', async () => {
    const { group, eventIds } = await seedGroup()
    const creator = await createUser({ role: 'admin' })
    const member = await seedMember(eventIds, [...UNIT1, ...UNIT2], {
      familyName: '北海',
      givenName: '太郎',
    })
    await saveRoute(group.id, UNIT1[0]!, member.id, [
      { date: '2026-11-06', from: '札幌', to: '帯広' },
    ])
    await saveRoute(group.id, UNIT2[0]!, member.id, [
      { date: '2026-11-16', from: '帯広', to: '旭川' },
    ])

    const { files } = await loadTravelReportDefaults(group.id)
    // 2単位（非連続）を1ファイルへ統合。
    const merged = { ...files[0]!, dates: [...UNIT1, ...UNIT2] }
    const result = await createTravelReports(group.id, [merged], creator.id)
    const [doc] = await testDb
      .select()
      .from(travelReportDocuments)
      .where(eq(travelReportDocuments.id, result.documents[0]!.id))
    const view = await readTravelReportDocx(doc!.docx)

    // 備考に両単位の移動行が両方出る（片方が上書きされて欠落しない）。
    const remarks = view.headerCells[10]![1]!
    expect(remarks).toContain('11/6 [北海]札幌→帯広')
    expect(remarks).toContain('11/16 [北海]帯広→旭川')
    // 期間も両単位の移動行を通して 11/6〜11/16（11日間）になる。
    const period = view.headerCells[8]![1]!
    expect(period).toContain('11月　　6日')
    expect(period).toContain('11月　　16日')
    expect(period).toContain('11日間')
  })
})
