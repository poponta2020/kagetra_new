import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import { tallyEntryFees, tallyEntryFeesForGroup } from '@/lib/entry-fee-tally'

/**
 * grade-entry-fee タスク3: 参加者の級別内訳・総額の集計（AC-9 〜 AC-12）。
 * 単価解決（official/kind の分岐）は entry-fee.test.ts で純関数として固定済みなので、
 * ここでは母集団・DB 集計側だけを検証する。
 */

// beforeEach/afterAll は describe をまたいでファイルスコープに1つだけ置く
// （describe ごとに afterAll(closeTestDb) を書くと、先に完了した describe の
// afterAll で pool が end され、後続 describe の truncateAll が
// "Cannot use a pool after calling end on the pool" で落ちる）。
beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('tallyEntryFees', () => {
  it('AC-9: 母集団は attend=true ∩ is_invited=true ∩ 対象級（page.tsx の eligibleAttendingList と同じ集合）', async () => {
    const event = await createEvent({
      official: true,
      kind: 'individual',
      eligibleGrades: ['A', 'B'],
    })

    // カウントされる唯一の型: 対象級・招待済み・出席。
    const counted = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: counted.id, attend: true })

    // attend=false は除外。
    const notAttending = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: notAttending.id, attend: false })

    // isInvited=false は除外。
    const notInvited = await createUser({ grade: 'A', isInvited: false })
    await createEventAttendance({ eventId: event.id, userId: notInvited.id, attend: true })

    // 対象級外（eligibleGrades=['A','B'] に含まれない C）は除外。
    const outOfGrade = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: outOfGrade.id, attend: true })

    const result = await tallyEntryFees(testDb, [event.id])

    // 対象級 A のみ・1名だけがカウントされる → A級単価 2,500円 × 1名。
    expect(result.totalJpy).toBe(2500)
    expect(result.breakdownLabel).toBe('A級 1名×2,500')
    expect(result.unknownGradeCount).toBe(0)
  })

  it('AC-10: eligible_grades が非空なら級未設定の会員は母集団に入らず、unknownGradeCount も 0 のまま', async () => {
    const event = await createEvent({
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
    })
    const graded = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: graded.id, attend: true })
    const ungraded = await createUser({ grade: null, isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: ungraded.id, attend: true })

    const result = await tallyEntryFees(testDb, [event.id])

    expect(result.totalJpy).toBe(2500)
    expect(result.unknownGradeCount).toBe(0)
  })

  it('AC-10: eligible_grades が NULL/空配列なら級未設定の会員も母集団に入り、総額には算入せず unknownGradeCount に計上する', async () => {
    const event = await createEvent({
      official: true,
      kind: 'individual',
      eligibleGrades: null,
    })
    const graded = await createUser({ grade: 'B', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: graded.id, attend: true })
    const ungraded = await createUser({ grade: null, isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: ungraded.id, attend: true })

    const result = await tallyEntryFees(testDb, [event.id])

    // B級規定額 2,500円 × 1名。級未設定の1名は 0 円として足さず、未算入に計上する。
    expect(result.totalJpy).toBe(2500)
    expect(result.breakdownLabel).toBe('B級 1名×2,500')
    expect(result.unknownGradeCount).toBe(1)
  })

  it("AC-11: kind='team' では総額を算出しない（totalJpy が null）", async () => {
    const event = await createEvent({
      official: true,
      kind: 'team',
      eligibleGrades: ['A'],
      feeJpy: 10_000,
    })
    const member = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const result = await tallyEntryFees(testDb, [event.id])

    expect(result.totalJpy).toBeNull()
    expect(result.breakdownLabel).toBeNull()
    expect(result.unknownGradeCount).toBe(0)
  })

  it('AC-11: official=false では総額を算出しない（totalJpy が null）', async () => {
    const event = await createEvent({
      official: false,
      kind: 'individual',
      eligibleGrades: ['A'],
      feeJpy: 3000,
    })
    const member = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const result = await tallyEntryFees(testDb, [event.id])

    expect(result.totalJpy).toBeNull()
    expect(result.breakdownLabel).toBeNull()
  })

  it('AC-12: 複数イベント（グループ全日）を渡すと合算され、日別に割られない', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
    })
    const day2 = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
    })

    // 同じ会員が2日とも出席 → 2日分としてカウントする（重複排除しない）。
    const member = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: day1.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: day2.id, userId: member.id, attend: true })

    const result = await tallyEntryFees(testDb, [day1.id, day2.id])

    expect(result.totalJpy).toBe(5000)
    expect(result.breakdownLabel).toBe('A級 2名×2,500')
  })

  it('AC-12: イベントごとに eligible_grades が違う場合、イベント単位でフィルタしてから合算する', async () => {
    const group = await createEntryGroup()
    // A級大会。
    const dayA = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
    })
    // E級大会。
    const dayE = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['E'],
    })

    const gradeAMember = await createUser({ grade: 'A', isInvited: true })
    await createEventAttendance({ eventId: dayA.id, userId: gradeAMember.id, attend: true })
    // E級会員は dayA の対象級外なので dayA には出さず dayE にのみ出席。
    const gradeEMember = await createUser({ grade: 'E', isInvited: true })
    await createEventAttendance({ eventId: dayE.id, userId: gradeEMember.id, attend: true })
    // dayA の対象級外の会員が誤って dayA の出席に紐づいていても、対象級フィルタで落ちる。
    await createEventAttendance({ eventId: dayA.id, userId: gradeEMember.id, attend: true })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    // A級 2,500円×1名 + E級 1,500円×1名。
    expect(result.totalJpy).toBe(4000)
    expect(result.breakdownLabel).toBe('A級 1名×2,500 / E級 1名×1,500')
  })

  it('AC-11×AC-12: グループ内の一部が team/非公認でも、除外するだけで合算全体を諦めない', async () => {
    const group = await createEntryGroup()
    // team 戦の日（総額対象外）。
    const teamDay = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'team',
      eligibleGrades: ['C'],
      feeJpy: 10_000,
    })
    // official な個人戦の日（総額対象）。
    const individualDay = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
    })

    const teamMember = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({ eventId: teamDay.id, userId: teamMember.id, attend: true })
    const individualMember = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({
      eventId: individualDay.id,
      userId: individualMember.id,
      attend: true,
    })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    // team 日は除外し、individual 日の C級規定額 2,000円×1名だけを合算する
    // （team が混ざっているせいで totalJpy が null に倒れたり、team の10,000円が
    // 混入したりしないことを固定する）。
    expect(result.totalJpy).toBe(2000)
    expect(result.breakdownLabel).toBe('C級 1名×2,000')
  })

  it('参加者0名なら総額 0・内訳なしを返す', async () => {
    const event = await createEvent({
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
    })

    const result = await tallyEntryFees(testDb, [event.id])

    expect(result.totalJpy).toBe(0)
    expect(result.breakdownLabel).toBeNull()
    expect(result.unknownGradeCount).toBe(0)
  })

  it('eventIds が空配列ならクエリを撃たずに即返す', async () => {
    const result = await tallyEntryFees(testDb, [])

    expect(result).toEqual({ totalJpy: null, breakdownLabel: null, unknownGradeCount: 0 })
  })
})

describe('tallyEntryFeesForGroup', () => {
  it('グループの全イベントを対象に集計する', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
    })
    const day2 = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
    })
    const member1 = await createUser({ grade: 'C', isInvited: true })
    const member2 = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({ eventId: day1.id, userId: member1.id, attend: true })
    await createEventAttendance({ eventId: day2.id, userId: member2.id, attend: true })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    expect(result.totalJpy).toBe(4000)
    expect(result.breakdownLabel).toBe('C級 2名×2,000')
  })

  it('中止した日は合算に含めない（振込む額が発生しないため）', async () => {
    const group = await createEntryGroup()
    const live = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
    })
    const cancelled = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
      status: 'cancelled',
    })
    const member = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({ eventId: live.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: cancelled.id, userId: member.id, attend: true })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    expect(result.totalJpy).toBe(2000)
    expect(result.breakdownLabel).toBe('C級 1名×2,000')
  })

  it('現地払いの日は合算に含めない（当日各自が払うので振込には乗らない）', async () => {
    // setPaymentType は1日単位で変更できるため、同一グループ内で支払方法が混在しうる。
    // 混ぜて合算すると支払締切リマインドが実際の振込額より多い金額を案内し、once-ever
    // なので訂正できない。
    const group = await createEntryGroup()
    const advanceDay = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['A'],
      paymentType: 'advance',
    })
    const onsiteDay = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['E'],
      paymentType: 'onsite',
    })
    const memberA = await createUser({ grade: 'A', isInvited: true })
    const memberE = await createUser({ grade: 'E', isInvited: true })
    await createEventAttendance({ eventId: advanceDay.id, userId: memberA.id, attend: true })
    await createEventAttendance({ eventId: onsiteDay.id, userId: memberE.id, attend: true })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    // 事前払いの A級 2,500円 のみ。現地払いの E級 1,500円 を足した 4,000円ではない。
    expect(result.totalJpy).toBe(2500)
    expect(result.breakdownLabel).toBe('A級 1名×2,500')
  })

  it('支払方法が未設定（NULL＝支払い通知なし）の日も合算に含めない', async () => {
    const group = await createEntryGroup()
    const noPaymentDay = await createEvent({
      entryGroupId: group.id,
      official: true,
      kind: 'individual',
      eligibleGrades: ['C'],
      paymentType: null,
    })
    const member = await createUser({ grade: 'C', isInvited: true })
    await createEventAttendance({ eventId: noPaymentDay.id, userId: member.id, attend: true })

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    // 振込対象の日が1つも無い → 「0円」ではなく「算出できない」を返す（金額行を出さない）。
    expect(result).toEqual({ totalJpy: null, breakdownLabel: null, unknownGradeCount: 0 })
  })

  it('グループにイベントが無ければ即返す', async () => {
    const group = await createEntryGroup()

    const result = await tallyEntryFeesForGroup(testDb, group.id)

    expect(result).toEqual({ totalJpy: null, breakdownLabel: null, unknownGradeCount: 0 })
  })
})
